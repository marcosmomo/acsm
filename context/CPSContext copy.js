// /context/CPSContext.js
'use client';

import React, {
  createContext,
  useState,
  useContext,
  useMemo,
  useEffect,
  useRef,
  useCallback,
} from 'react';
import { cpsDatabase } from '../data/db';

const GENERATE_SENSOR_ALERTS = false;

const CPSContext = createContext();
export const useCPSContext = () => useContext(CPSContext);

// Broker WS/WSS
const DEFAULT_BROKER_URL =
  typeof window !== 'undefined' && window.location.protocol === 'https:'
    ? 'wss://broker.hivemq.com:8884/mqtt'
    : 'ws://broker.hivemq.com:8000/mqtt';

// Helpers de tópico
const joinTopic = (base, suffix) =>
  `${String(base).replace(/\/+$/, '')}/${String(suffix).replace(/^\/+/, '')}`;

const COMMAND_TOPIC_SUFFIX = 'cmd';
const DATA_TOPIC_SUFFIX = 'data';
const ACK_TOPIC_SUFFIX = 'ack';
const STATUS_TOPIC_SUFFIX = 'status';

const DEBUG_LOG_ALL_TOPICS = true;

const normalizeTopic = (t) =>
  String(t || '').replace(/^\/+/, '').replace(/\/+$/, '');

const topicVariants = (t) => {
  const noLead = normalizeTopic(t);
  const withLead = `/${noLead}`;
  return [noLead, withLead];
};

// detectar tópico de funcionalidade: .../<base>/feat/<key>/$state
const parseFeatureStateTopic = (base, incoming) => {
  const baseNorm = normalizeTopic(base);
  const incNorm = normalizeTopic(incoming);
  if (!(incNorm === baseNorm || incNorm.startsWith(`${baseNorm}/`))) return null;
  const rel = incNorm.slice(baseNorm.length).replace(/^\/+/, '');
  const parts = rel.split('/');
  if (parts.length >= 3 && parts[0] === 'feat' && parts[2] === '$state') {
    return { featKey: parts[1] };
  }
  return null;
};

// [NEW] – constrói a lista de tópicos para um CPS
const buildSubscriptionTopicsForCps = (cps) => {
  if (!cps?.topic) return [];
  const [baseNo, baseWith] = topicVariants(cps.topic);

  const cmdNo = joinTopic(baseNo, COMMAND_TOPIC_SUFFIX);
  const cmdWith = joinTopic(baseWith, COMMAND_TOPIC_SUFFIX);
  const dataNo = joinTopic(baseNo, DATA_TOPIC_SUFFIX);
  const dataWith = joinTopic(baseWith, DATA_TOPIC_SUFFIX);
  const ackNo = joinTopic(baseNo, ACK_TOPIC_SUFFIX);
  const ackWith = joinTopic(baseWith, ACK_TOPIC_SUFFIX);
  const statusNo = joinTopic(baseNo, STATUS_TOPIC_SUFFIX);
  const statusWith = joinTopic(baseWith, STATUS_TOPIC_SUFFIX);

  const featStates = (cps.funcionalidades || []).flatMap((f) => {
    const state = f?.topics?.state;
    if (!state) return [];
    const [fsNo, fsWith] = topicVariants(state);
    return [fsNo, fsWith];
  });

  return [
    baseNo, baseWith,
    cmdNo, cmdWith,
    dataNo, dataWith,
    ackNo, ackWith,
    statusNo, statusWith,
    ...featStates,
  ].filter(Boolean);
};

// Loader mqtt
async function loadMqttConnect() {
  const mod = await import('mqtt');
  const connect =
    mod?.connect ||
    mod?.default?.connect ||
    (typeof mod?.default === 'function' ? mod.default : undefined);
  return typeof connect === 'function' ? connect : null;
}

export const CPSProvider = ({ children }) => {
  const availableCPSNames = useMemo(
    () => Object.values(cpsDatabase).map((cps) => cps.nome),
    []
  );

  const [addedCPS, setAddedCPS] = useState([]);
  const [log, setLog] = useState([]);
  const [mqttClient, setMqttClient] = useState(null);
  const [mqttData, setMqttData] = useState({});
  const [alerts, setAlerts] = useState([]);

  const addedCPSRef = useRef([]);
  useEffect(() => {
    addedCPSRef.current = addedCPS;
  }, [addedCPS]);

  // Conexão MQTT
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let client;

    const start = async () => {
      try {
        const connect = await loadMqttConnect();
        if (!connect) {
          setLog((prev) => [
            ...prev,
            {
              time: new Date().toLocaleTimeString(),
              message:
                '[MQTT_ERROR] Não foi possível obter connect() do pacote mqtt. Recomendo mqtt@^5.',
            },
          ]);
          return;
        }

        client = connect(DEFAULT_BROKER_URL, {
          clean: true,
          reconnectPeriod: 1000,
          clientId: `cps-ui-${Math.random().toString(16).slice(2)}`,
        });

        client.on('connect', () => {
          setMqttClient(client);
          setLog((prev) => [
            ...prev,
            {
              time: new Date().toLocaleTimeString(),
              message: `[MQTT] Conectado a ${DEFAULT_BROKER_URL}`,
            },
          ]);
        });

        client.on('message', (topic, message) => {
          const rawTopic = String(topic || '').trim();

          if (DEBUG_LOG_ALL_TOPICS) {
            setLog((prev) => [
              ...prev,
              {
                time: new Date().toLocaleTimeString(),
                message: `[DEBUG] msg em '${rawTopic}': ${message?.toString?.()}`,
              },
            ]);
          }

          const normIncoming = normalizeTopic(rawTopic);
          const current = addedCPSRef.current;

          // encontra o dono da mensagem
          const owner = current.find((cps) => {
            const base = normalizeTopic(cps.topic);
            return normIncoming === base || normIncoming.startsWith(`${base}/`);
          });
          if (!owner) return;

          // [NEW] – se o CPS está Parado, ignorar qualquer mensagem dele
          if (String(owner.status).toLowerCase() !== 'rodando') {
            return;
          }

          // 1) Mensagens de funcionalidade ($state)
          const featInfo = parseFeatureStateTopic(owner.topic, normIncoming);
          if (featInfo?.featKey) {
            let payload = null;
            try {
              payload = JSON.parse(message.toString());
            } catch {
              setLog((prev) => [
                ...prev,
                {
                  time: new Date().toLocaleTimeString(),
                  message: `[FEAT] payload não-JSON em '${rawTopic}': ${message?.toString?.()}`,
                },
              ]);
            }

            const statusKey = String(payload?.status || '').toLowerCase();
            const ts = payload?.ts || Date.now();
            const details = payload?.details;

            setAddedCPS((prev) =>
              prev.map((c) => {
                if (c.id !== owner.id) return c;
                const funcs = (c.funcionalidades || []).map((f) => {
                  if (f.key !== featInfo.featKey) return f;
                  return {
                    ...f,
                    statusAtual: ['espera', 'falha', 'manutencao'].includes(statusKey)
                      ? statusKey
                      : f.statusAtual ?? null,
                    lastUpdate: ts,
                    lastDetails: details,
                  };
                });
                return { ...c, funcionalidades: funcs };
              })
            );

            if (statusKey === 'falha' || statusKey === 'manutencao') {
              const compName =
                owner.funcionalidades?.find((f) => f.key === featInfo.featKey)?.nome ||
                featInfo.featKey;

              const alertObj = {
                id: `${owner.id}-${featInfo.featKey}-${ts}`,
                cpsId: owner.id,
                cpsName: owner.nome,
                component: compName,
                severity: statusKey === 'falha' ? 'high' : 'medium',
                timestamp: new Date(ts).toISOString(),
                raw: {
                  type: 'feature_state',
                  status: statusKey,
                  featKey: featInfo.featKey,
                  details,
                },
              };
              setAlerts((prev) => [alertObj, ...prev].slice(0, 200));
              setLog((prev) => [
                ...prev,
                {
                  time: new Date().toLocaleTimeString(),
                  message: `[FEAT] ${owner.nome} • ${compName} → status=${statusKey}`,
                },
              ]);
            }

            return;
          }

          // 2) Fluxos existentes (data/status/ack)
          const isData =
            normIncoming.endsWith(`/${DATA_TOPIC_SUFFIX}`) ||
            normIncoming.includes(`/${DATA_TOPIC_SUFFIX}/`);
          const isAck =
            normIncoming.endsWith(`/${ACK_TOPIC_SUFFIX}`) ||
            normIncoming.includes(`/${ACK_TOPIC_SUFFIX}/`);
          const isStatus =
            normIncoming.endsWith(`/${STATUS_TOPIC_SUFFIX}`) ||
            normIncoming.includes(`/${STATUS_TOPIC_SUFFIX}/`);

          if (isData) {
            try {
              const data = JSON.parse(message.toString());

              if (!(data && data.type === 'alert')) {
                setMqttData((prev) => ({ ...prev, [owner.id]: data }));
              }

              if (data && data.type === 'alert') {
                const alertObj = {
                  id: data.correlation_id || `${owner.id}-${Date.now()}`,
                  correlation_id: data.correlation_id,
                  cpsId: owner.id,
                  cpsName: owner.nome,
                  component: data.component,
                  severity: data.severity || 'low',
                  risk_score: data.risk_score,
                  predicted_ttf_hours: data.predicted_ttf_hours,
                  timestamp: data.timestamp || new Date().toISOString(),
                  raw: data,
                };

                setAlerts((prev) => [alertObj, ...prev].slice(0, 200));

                setLog((prev) => [
                  ...prev,
                  {
                    time: new Date().toLocaleTimeString(),
                    message: `[ALERT] ${owner.nome} • ${alertObj.component} • sev=${alertObj.severity} • risk=${alertObj.risk_score}`,
                  },
                ]);
              }
            } catch (err) {
              setMqttData((prev) => ({ ...prev, [owner.id]: message.toString() }));
            }
          } else if (isStatus) {
            try {
              const data = JSON.parse(message.toString());
              const variable = data?.variable || 'variável';
              const value = data?.value;
              const sev =
                data?.severity ||
                (data?.below_threshold === true ? 'low' : 'medium');

              const alertObj = {
                id: data.correlation_id || `${owner.id}-${variable}-${Date.now()}`,
                correlation_id: data.correlation_id,
                cpsId: owner.id,
                cpsName: owner.nome,
                component: data.component || 'Status',
                severity: sev,
                risk_score: undefined,
                predicted_ttf_hours: undefined,
                timestamp: data.timestamp || new Date().toISOString(),
                raw: data,
              };

              setAlerts((prev) => [alertObj, ...prev].slice(0, 200));

              setLog((prev) => [
                ...prev,
                {
                  time: new Date().toLocaleTimeString(),
                  message: `[STATUS] ${owner.nome} • ${variable}=${value} (sev=${sev})`,
                },
              ]);
            } catch (e) {
              setLog((prev) => [
                ...prev,
                {
                  time: new Date().toLocaleTimeString(),
                  message: `[STATUS] payload não-JSON em '${rawTopic}': ${message?.toString?.()}`,
                },
              ]);
            }
          } else if (isAck) {
            // opcional: tratar ACK
          }
        });

        client.on('error', (err) => {
          setLog((prev) => [
            ...prev,
            {
              time: new Date().toLocaleTimeString(),
              message: `[MQTT_ERROR] ${err?.message || String(err)}`,
            },
          ]);
        });
      } catch (e) {
        setLog((prev) => [
          ...prev,
          {
            time: new Date().toLocaleTimeString(),
            message: `[MQTT_ERROR] Falha ao importar/conectar mqtt: ${e?.message || e}`,
          },
        ]);
      }
    };

    start();
    return () => {
      if (client) client.end(true);
    };
  }, []);

  // Subscriptions – [NEW] agora só para CPS Rodando
  useEffect(() => {
    if (!mqttClient) return;

    // tópicos desejados (apenas rodando)
    const topicsToSubscribe = addedCPS
      .filter((cps) => String(cps.status).toLowerCase() === 'rodando')
      .flatMap(buildSubscriptionTopicsForCps);

    const uniqueSubs = [...new Set(topicsToSubscribe)];
    if (!uniqueSubs.length) return;

    mqttClient.subscribe(uniqueSubs, (err) => {
      setLog((prev) => [
        ...prev,
        {
          time: new Date().toLocaleTimeString(),
          message: err
            ? `[MQTT_ERROR] Falha ao subscrever (${err?.message || err})`
            : `[MQTT] Subscreveu: ${uniqueSubs.join(', ')}`,
        },
      ]);
    });

    // quando a lista mudar, desinscreve tudo e resinscreve no próximo ciclo
    return () => {
      mqttClient.unsubscribe(uniqueSubs);
    };
  }, [mqttClient, addedCPS]); // reexecuta se status mudar

  // ===== Helpers de publicação =====
  const publishTextCommandAsync = (cps, text) =>
    new Promise((resolve) => {
      if (!mqttClient || !cps) return resolve(false);
      const [baseNo] = topicVariants(cps.topic);
      const commandTopic = joinTopic(baseNo, COMMAND_TOPIC_SUFFIX);
      mqttClient.publish(commandTopic, text, { qos: 1 }, (err) => {
        setLog((prev) => [
          ...prev,
          {
            time: new Date().toLocaleTimeString(),
            message: err
              ? `[MQTT_ERRO] Falha ao publicar (${cps.nome})`
              : `[MQTT_PUB] "${text}" → ${commandTopic}`,
          },
        ]);
        resolve(!err);
      });
    });

  const publishTextCommand = (cps, text) => publishTextCommandAsync(cps, text);

  // ===== Ciclo de vida =====

  const clearLog = () => {
    setLog([]);
    setLog((prev) => [
      ...prev,
      {
        time: new Date().toLocaleTimeString(),
        message: '[INFO] Log limpo pelo usuário.',
      },
    ]);
  };

  const addCPS = (cpsName, options = {}) => {
    const { startAfterPlug = true } = options;

    const lower = (cpsName || '').toLowerCase();
    const fromDB = cpsDatabase[lower];
    if (!fromDB) {
      setLog((prev) => [
        ...prev,
        {
          time: new Date().toLocaleTimeString(),
          message: `[ERRO] ${cpsName} não encontrado no banco.`,
        },
      ]);
      return false;
    }
    if (addedCPS.some((c) => c.id === fromDB.id)) {
      setLog((prev) => [
        ...prev,
        {
          time: new Date().toLocaleTimeString(),
          message: `[WARN] ${cpsName} já está plugado.`,
        },
      ]);
      return false;
    }

    const initialStatus = startAfterPlug ? 'Rodando' : 'Parado';
    const cps = { ...fromDB, status: initialStatus };
    setAddedCPS((prev) => [...prev, cps]);
    setLog((prev) => [
      ...prev,
      {
        time: new Date().toLocaleTimeString(),
        message: `[PLUG] ${cpsName} adicionado. (autoStart=${startAfterPlug})`,
      },
    ]);

    if (startAfterPlug) {
      publishTextCommand(cps, 'iniciar operações');
    }
    return true;
  };

  const removeCPS = (cpsName) => {
    const lower = (cpsName || '').toLowerCase();
    const removed = addedCPS.find((c) => c.nome.toLowerCase() === lower);
    if (!removed) {
      setLog((prev) => [
        ...prev,
        {
          time: new Date().toLocaleTimeString(),
          message: `[WARN] ${cpsName} não está plugado.`,
        },
      ]);
      return false;
    }
    if (mqttClient) {
      const topics = buildSubscriptionTopicsForCps(removed); // [NEW]
      mqttClient.unsubscribe(topics);
      setLog((prev) => [
        ...prev,
        {
          time: new Date().toLocaleTimeString(),
          message: `[MQTT] Unsubscribe: ${topics.join(', ')}`,
        },
      ]);
    }
    setAddedCPS((prev) => prev.filter((c) => c.nome.toLowerCase() !== lower));
    setMqttData((prev) => {
      const x = { ...prev };
      delete x[removed.id];
      return x;
    });
    setLog((prev) => [
      ...prev,
      {
        time: new Date().toLocaleTimeString(),
        message: `[PLUG] ${removed.nome} removido.`,
      },
    ]);
    return true;
  };

  const startCPSById = (cpsId) => {
    const cps = addedCPS.find((c) => c.id === cpsId);
    if (!cps) return;
    publishTextCommand(cps, 'iniciar operações');
    setAddedCPS((prev) =>
      prev.map((c) => (c.id === cpsId ? { ...c, status: 'Rodando' } : c))
    );
    // [NEW] – não precisa subscrever manualmente; o efeito de subscriptions reagirá à mudança de status
  };

  const stopCPSById = (cpsId) => {
    const cps = addedCPS.find((c) => c.id === cpsId);
    if (!cps) return;
    publishTextCommand(cps, 'parar');
    setAddedCPS((prev) =>
      prev.map((c) => (c.id === cpsId ? { ...c, status: 'Parado' } : c))
    );
    // [NEW] – limpa último dado e evita que fique parecendo "ativo"
    setMqttData((prev) => {
      const next = { ...prev };
      delete next[cpsId];
      return next;
    });
    // [NEW] – o efeito de subscriptions vai desinscrever automaticamente
  };

  const unplugCPS = async (cpsName) => {
    const lower = (cpsName || '').toLowerCase();
    const removed = addedCPS.find((c) => c.nome.toLowerCase() === lower);
    if (!removed) {
      setLog((prev) => [
        ...prev,
        {
          time: new Date().toLocaleTimeString(),
          message: `[WARN] ${cpsName} não está plugado.`,
        },
      ]);
      return false;
    }

    await publishTextCommandAsync(removed, 'parar');
    await publishTextCommandAsync(removed, 'unplug');
    await new Promise((r) => setTimeout(r, 200));

    if (mqttClient) {
      const topics = buildSubscriptionTopicsForCps(removed); // [NEW]
      mqttClient.unsubscribe(topics);
    }

    setAddedCPS((prev) => prev.filter((c) => c.nome.toLowerCase() !== lower));
    setMqttData((prev) => {
      const x = { ...prev };
      delete x[removed.id];
      return x;
    });

    setLog((prev) => [
      ...prev,
      {
        time: new Date().toLocaleTimeString(),
        message: `[UNPLUG] ${removed.nome} desligado e removido da arquitetura.`,
      },
    ]);

    return true;
  };

  const toggleCPSStatus = (cpsId, newStatus) => {
    if (newStatus === 'Rodando') startCPSById(cpsId);
    else if (newStatus === 'Parado') stopCPSById(cpsId);
  };

  const getMQTTOperations = useCallback(() => {
    if (addedCPS.length === 0)
      return 'Nenhum CPS adicionado. Conecte ao broker para receber dados.';

    return addedCPS
      .map((cps) => {
        const currentData = mqttData[cps.id];
        const feats = (cps.funcionalidades || [])
          .map((f) => `${f.nome}=${String(f.statusAtual ?? '—')}`)
          .join(', ');
        const featLine = feats ? ` • Func: [${feats}]` : '';

        // [NEW] – se Parado, deixa claro e não mostra última payload como se estivesse ativo
        if (String(cps.status).toLowerCase() !== 'rodando') {
          return `${cps.nome} (${cps.server}/${cps.topic}): Parado${featLine ? featLine : ''}`;
        }

        if (currentData && typeof currentData === 'object') {
          return `${cps.nome} (${cps.server}/${cps.topic}): ${JSON.stringify(currentData)}${featLine}`;
        }
        const last = currentData || 'Aguardando...';
        return `${cps.nome} (${cps.server}/${cps.topic}): Última Msg: ${last}${featLine}`;
      })
      .join('\n\n');
  }, [addedCPS, mqttData]);

  const acknowledgeAlert = (idOrCorrelation) => {
    setAlerts((prev) =>
      prev.filter(
        (a) => a.id !== idOrCorrelation && a.correlation_id !== idOrCorrelation
      )
    );
    setLog((prev) => [
      ...prev,
      {
        time: new Date().toLocaleTimeString(),
        message: `[INFO] Alerta reconhecido (${idOrCorrelation}).`,
      },
    ]);
  };

  const clearAlerts = () => {
    setAlerts([]);
    setLog((prev) => [
      ...prev,
      {
        time: new Date().toLocaleTimeString(),
        message: `[INFO] Todos os alertas foram limpos pelo usuário.`,
      },
    ]);
  };

  return (
    <CPSContext.Provider
      value={{
        availableCPSNames,
        addedCPS,
        log,
        addCPS,
        removeCPS,
        startCPSById,
        stopCPSById,
        unplugCPS,
        toggleCPSStatus,
        clearLog,
        alerts,
        acknowledgeAlert,
        clearAlerts,
        showCPSDescription: (name) => {
          const lower = (name || '').toLowerCase();
          const cps =
            addedCPS.find((c) => c.nome.toLowerCase() === lower) ||
            cpsDatabase[lower];
          if (!cps) return false;
          alert(`CPS: ${cps.nome}\nDescrição: ${cps.descricao || '(sem descrição)'}`);
          setLog((prev) => [
            ...prev,
            {
              time: new Date().toLocaleTimeString(),
              message: `[INFO] Descrição de ${cps.nome} exibida.`,
            },
          ]);
          return true;
        },
        getMQTTOperations,
      }}
    >
      {children}
    </CPSContext.Provider>
  );
};

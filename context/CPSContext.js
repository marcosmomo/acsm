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

const CPSContext = createContext();
export const useCPSContext = () => useContext(CPSContext);

// Broker WS/WSS (a UI usa WebSocket; o CPS pode publicar por TCP 1883 sem problemas)
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

// Delay entre aparições de CPS carregados automaticamente (em ms)
const CPS_AUTOLOAD_DELAY_MS = 3000; // 3 segundos

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

// constrói lista de tópicos para um CPS
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
  // ===== Registro (preenchido pelo JSON do Plug) =====
  const [registry, setRegistry] = useState({}); // { nomeLowerOrId: cpsObj }

  // Nomes disponíveis no Plug (sem duplicados)
  const availableCPSNames = useMemo(
    () =>
      Array.from(
        new Set(
          Object.values(registry)
            .filter(Boolean)
            .map((cps) => cps.nome)
        )
      ),
    [registry]
  );

  // ===== Estado geral =====
  const [addedCPS, setAddedCPS] = useState([]); // CPS plugados (Play)
  const [log, setLog] = useState([]);
  const [mqttClient, setMqttClient] = useState(null);
  const [mqttData, setMqttData] = useState({});
  const [alerts, setAlerts] = useState([]);

  // ===== Registrar CPS a partir do JSON (AAS) =====
  const registerCPS = useCallback(
    (parsed) => {
      try {
        // DataConnection
        const smDataConn = (parsed?.submodels || []).find(
          (sm) => sm?.idShort === 'DataConnection'
        );
        if (!smDataConn) throw new Error('Submodel "DataConnection" ausente.');

        const props = Object.fromEntries(
          (smDataConn.submodelElements || [])
            .filter((e) => e?.modelType === 'Property')
            .map((e) => [e.idShort, e.value])
        );

        const cpsId = props.CpsId || props.cpsId || 'CPS-UNKNOWN';
        const nome = props.Name || props.name || cpsId;
        const desc = props.Description || '';
        const server = props.MqttServer || 'broker.hivemq.com';
        const base = props.MqttBaseTopic || cpsId; // ex.: "cps1" no seu JSON
        const topic = String(base).replace(/^\/+|\/+$/g, ''); // sem barras nas pontas

        // Functions -> funcionalidades
        const smFuncs = (parsed?.submodels || []).find(
          (sm) => sm?.idShort === 'Functions'
        );
        const funcionalidades = [];

        for (const el of smFuncs?.submodelElements || []) {
          const key = el?.idShort; // ex.: "soldagem"
          if (!key) continue;

          const dict = Object.fromEntries(
            (el?.value || [])
              .filter((e) => e?.modelType === 'Property')
              .map((e) => [e.idShort, e.value])
          );

          funcionalidades.push({
            key,
            nome: dict.Name || key,
            descricao: dict.Description || '',
            allowed: (dict.AllowedStatuses || '').split('|').filter(Boolean),
            statusAtual: null, // será atualizado por mensagens $state
            lastUpdate: null,
            lastDetails: null,
            topics: {
              state: `${topic}/feat/${key}/$state`,
            },
          });
        }

        const cpsObj = {
          id: cpsId,
          nome,
          descricao: desc,
          server,
          topic, // base pro subscribe/publicar comandos
          status: 'Parado',
          funcionalidades,
        };

        setRegistry((prev) => ({
          ...prev,
          [nome.toLowerCase()]: cpsObj,
          [cpsId.toLowerCase()]: cpsObj,
        }));

        setLog((prev) => [
          ...prev,
          {
            time: new Date().toLocaleTimeString(),
            message: `[REGISTER] ${nome} registrado (topic=${topic}, funcionalidades=${funcionalidades.length}).`,
          },
        ]);

        return true;
      } catch (err) {
        setLog((prev) => [
          ...prev,
          {
            time: new Date().toLocaleTimeString(),
            message: `[REGISTER_ERROR] ${err?.message || err}`,
          },
        ]);
        return false;
      }
    },
    [setRegistry, setLog]
  );

  // 🔹 Auto-carrega CPS da API /api/cps ao montar, em "ondas" (3s, 6s, 9s...)
  useEffect(() => {
    let timeouts = [];

    const loadCpsFromServer = async () => {
      try {
        const res = await fetch('/api/cps');
        if (!res.ok) throw new Error('Falha ao buscar /api/cps');
        const data = await res.json();
        const arr = Array.isArray(data.cps) ? data.cps : [];

        arr.forEach((parsed, index) => {
          const delay = CPS_AUTOLOAD_DELAY_MS * (index + 1); // 3s, 6s, 9s...
          const id = setTimeout(() => {
            registerCPS(parsed);
          }, delay);
          timeouts.push(id);
        });
      } catch (e) {
        setLog((prev) => [
          ...prev,
          {
            time: new Date().toLocaleTimeString(),
            message: `[PLUG_LOAD_ERROR] Falha ao carregar CPS automáticos: ${
              e?.message || e
            }`,
          },
        ]);
      }
    };

    loadCpsFromServer();

    return () => {
      timeouts.forEach((id) => clearTimeout(id));
    };
  }, [registerCPS]);

  // Ponteiro para addedCPS
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

          const owner = current.find((cps) => {
            const base = normalizeTopic(cps.topic);
            return normIncoming === base || normIncoming.startsWith(`${base}/`);
          });
          if (!owner) return;

          // 👇 Agora o STOP só afeta a arquitetura:
          // se o CPS estiver "Parado" na UI, não atualizamos mais nada
          if (String(owner.status).toLowerCase() !== 'rodando') return;

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
                    statusAtual: ['espera', 'falha', 'manutencao', 'ativo', 'ok', 'rodando'].includes(statusKey)
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

          // 2) Outros fluxos (data/status/ack) — opcionais
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

  // Subscriptions – só para CPS Rodando
  useEffect(() => {
    if (!mqttClient) return;

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

    return () => {
      mqttClient.unsubscribe(uniqueSubs);
    };
  }, [mqttClient, addedCPS]);

  // Ciclo de vida

  // CPS entra em Play (pode já entrar "Rodando" ou "Parado", mas não mandamos comando pro CPS)
  const addCPS = (cpsName, options = {}) => {
    const { startAfterPlug = true } = options;
    const lower = (cpsName || '').toLowerCase();
    const fromRegistry = registry[lower];

    if (!fromRegistry) {
      setLog((prev) => [
        ...prev,
        {
          time: new Date().toLocaleTimeString(),
          message: `[ERRO] ${cpsName} não encontrado no registro (carregue o JSON antes).`,
        },
      ]);
      return false;
    }

    if (addedCPS.some((c) => c.id === fromRegistry.id)) {
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
    const cps = { ...fromRegistry, status: initialStatus };
    setAddedCPS((prev) => [...prev, cps]);

    setLog((prev) => [
      ...prev,
      {
        time: new Date().toLocaleTimeString(),
        message: `[PLAY] ${cpsName} enviado para a Fase Play (autoStart=${startAfterPlug}).`,
      },
    ]);

    // 👇 Não envia mais "iniciar operações" para o CPS, só ajusta visão da arquitetura
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
      const topics = buildSubscriptionTopicsForCps(removed);
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
        message: `[PLAY] ${removed.nome} removido da Fase Play.`,
      },
    ]);
    return true;
  };

  // START: arquitetura passa a observar (não manda start para o CPS)
  const startCPSById = (cpsId) => {
    const cps = addedCPS.find((c) => c.id === cpsId);
    if (!cps) return;
    setAddedCPS((prev) =>
      prev.map((c) => (c.id === cpsId ? { ...c, status: 'Rodando' } : c))
    );
  };

  // STOP: arquitetura para de atualizar/observar (CPS continua gerando)
  const stopCPSById = (cpsId) => {
    const cps = addedCPS.find((c) => c.id === cpsId);
    if (!cps) return;

    setAddedCPS((prev) =>
      prev.map((c) => (c.id === cpsId ? { ...c, status: 'Parado' } : c))
    );

    // limpa dados atuais daquele CPS (apenas efeito visual na UI)
    setMqttData((prev) => {
      const next = { ...prev };
      delete next[cpsId];
      return next;
    });
  };

  // UNPLUG: arquitetura deixa de olhar para esse CPS (CPS continua por conta própria)
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

    // 👇 Não enviamos mais 'parar' ou 'unplug' via MQTT para o CPS

    if (mqttClient) {
      const topics = buildSubscriptionTopicsForCps(removed);
      mqttClient.unsubscribe(topics);
    }

    // 1) tira do Play
    setAddedCPS((prev) => prev.filter((c) => c.nome.toLowerCase() !== lower));

    // 2) limpa dados MQTT
    setMqttData((prev) => {
      const x = { ...prev };
      delete x[removed.id];
      return x;
    });

    // 3) tira do Plug (registro)
    setRegistry((prev) => {
      const next = { ...prev };
      delete next[lower];
      const idKey = (removed.id || '').toLowerCase();
      if (idKey && next[idKey]) delete next[idKey];
      return next;
    });

    setLog((prev) => [
      ...prev,
      {
        time: new Date().toLocaleTimeString(),
        message: `[UNPLUG] ${removed.nome} removido da arquitetura (CPS segue operando por conta própria).`,
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

        if (String(cps.status).toLowerCase() !== 'rodando') {
          return `${cps.nome} (${cps.server}/${cps.topic}): Parado${
            featLine ? featLine : ''
          }`;
        }

        if (currentData && typeof currentData === 'object') {
          return `${cps.nome} (${cps.server}/${cps.topic}): ${JSON.stringify(
            currentData
          )}${featLine}`;
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

  return (
    <CPSContext.Provider
      value={{
        availableCPSNames,
        addedCPS,
        log,
        registerCPS,
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
            Object.values(registry).find(
              (c) => c.nome && c.nome.toLowerCase() === lower
            );
          if (!cps) return false;
          alert(
            `CPS: ${cps.nome}\nDescrição: ${cps.descricao || '(sem descrição)'}`
          );
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

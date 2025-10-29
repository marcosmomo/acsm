// /data/db.js

// Prefixo único (sem barra inicial) para evitar colisão no broker público
const PROJECT_PREFIX = 'meuProjeto123'; // personalize!
const UNIQUE_PREFIX = `cps/${PROJECT_PREFIX}`; // ex.: "cps/meuProjeto123"

// helper para montar tópico base do CPS
const t = (name) => `${UNIQUE_PREFIX}/${name}`;

// helper base por funcionalidade
const featBase = (baseTopic, featKey) => `${baseTopic}/feat/${featKey}`;

// tópicos de funcionalidade (apenas $state, pois o status vem dinamicamente do CPS)
const featTopics = (baseTopic, featKey) => {
  const root = featBase(baseTopic, featKey);
  return {
    root,
    state: `${root}/$state`, // payload: { status: "espera"|"falha"|"manutencao", ts: <epoch_ms>, details?: {...} }
  };
};

// Status aceitos (map para UI)
export const STATUS_TYPES = [
  { key: 'espera', label: 'Em Espera', level: 'info' },
  { key: 'falha', label: 'Falha', level: 'error' },
  { key: 'manutencao', label: 'Em Manutenção', level: 'maint' },
];

/**
 * IMPORTANTE:
 * - A UI NÃO exibe sensores (mantidos apenas por compatibilidade).
 * - Cada funcionalidade receberá o status via MQTT no tópico topics.state.
 * - Inicialmente statusAtual = null até chegar o primeiro $state do CPS.
 */

export const initialCPSList = [
  // CPS-001 ---------------------------------------------------------
  {
    id: 'CPS-001',
    nome: 'RoboSoldagemAlfa',
    descricao:
      'Estação de soldagem robotizada de 6 eixos com monitoramento em tempo real da qualidade da junta.',
    sensores: [
      'Temperatura_Ponta_Solda',
      'Corrente_Arco_Digital',
      'Pressao_Gas_Protecao',
      'Visao_3D_Junta',
      'Vibracao_Braço_Eixo6',
    ],
    operacoes:
      'Ajuste Fino de Parâmetros de Solda, Otimização de Trajetória, Inspeção Automática Pós-Solda',
    status: 'Pronto',
    topic: t('cps1'),
    server: 'broker.hivemq.com',
    port: 8884,
    client: 'Node-Red',

    funcionalidades: [
      {
        key: 'soldagem',
        nome: 'Soldagem',
        descricao: 'Controle do arco e execução do cordão.',
        topics: featTopics(t('cps1'), 'soldagem'),
        statusAtual: null,
        allowedStatuses: ['espera', 'falha', 'manutencao'],
      },
      {
        key: 'otimizacao_trajetoria',
        nome: 'Otimização de Trajetória',
        descricao: 'Ajuste fino de caminho e velocidade do robô.',
        topics: featTopics(t('cps1'), 'otimizacao_trajetoria'),
        statusAtual: null,
        allowedStatuses: ['espera', 'falha', 'manutencao'],
      },
      {
        key: 'inspecao_possolda',
        nome: 'Inspeção Pós-solda',
        descricao: 'Análise de penetração e defeitos via visão.',
        topics: featTopics(t('cps1'), 'inspecao_possolda'),
        statusAtual: null,
        allowedStatuses: ['espera', 'falha', 'manutencao'],
      },
    ],
  },

  // CPS-002 ---------------------------------------------------------
  {
    id: 'CPS-002',
    nome: 'CNC_5Eixos_Evo',
    descricao:
      'Centro de usinagem de 5 eixos com compensação térmica e monitoramento de integridade estrutural.',
    sensores: [
      'Velocidade_Spindle',   // rpm
      'Posicao_Eixo_X',       // mm
      'Posicao_Eixo_Y',       // mm
      'Temperatura_Spindle',  // °C
      'Vibracao_Estrutura',   // mm/s ou g
    ],
    operacoes: 'Desbaste, Acabamento, Sonda de medição, Diagnóstico de vibração',
    status: 'Executando',
    topic: t('cps2'),
    server: 'broker.hivemq.com',
    port: 8884,
    client: 'Node-Red',

    funcionalidades: [
      {
        key: 'desbaste',
        nome: 'Desbaste',
        descricao: 'Ciclo de remoção de material em alta taxa.',
        topics: featTopics(t('cps2'), 'desbaste'),
        statusAtual: null,
        allowedStatuses: ['espera', 'falha', 'manutencao'],
      },
      {
        key: 'acabamento',
        nome: 'Acabamento',
        descricao: 'Passes finais para tolerância e rugosidade.',
        topics: featTopics(t('cps2'), 'acabamento'),
        statusAtual: null,
        allowedStatuses: ['espera', 'falha', 'manutencao'],
      },
      {
        key: 'probin',
        nome: 'Probing',
        descricao: 'Sonda de medição e alinhamento de referência.',
        topics: featTopics(t('cps2'), 'probin'),
        statusAtual: null,
        allowedStatuses: ['espera', 'falha', 'manutencao'],
      },
    ],
  },

  // CPS-003 ---------------------------------------------------------
  {
    id: 'CPS-003',
    nome: 'PrensaForja_Smart',
    descricao:
      'Prensa de forja com monitoramento de carga, temperatura, vibração e alinhamento, voltada para controle adaptativo de processo.',
    sensores: [
      'Carga_Cilindro',     // toneladas
      'Temperatura_Matriz', // °C
      'Vibracao_Estrutural',// mm/s
      'Deslocamento_Punção',// mm
      'Pressao_Hidraulica', // bar
    ],
    operacoes:
      'Ciclo de forja, Resfriamento controlado, Monitoramento de vibração e pressão',
    status: 'Aguardando_Carga',
    topic: t('cps3'),
    server: 'broker.hivemq.com',
    port: 8884,
    client: 'Node-Red',

    funcionalidades: [
      {
        key: 'ciclo_forja',
        nome: 'Ciclo de Forja',
        descricao: 'Golpe, recalque e extração da peça.',
        topics: featTopics(t('cps3'), 'ciclo_forja'),
        statusAtual: null,
        allowedStatuses: ['espera', 'falha', 'manutencao'],
      },
      {
        key: 'resfriamento',
        nome: 'Resfriamento Controlado',
        descricao: 'Gestão de tempo/fluxo para propriedades mecânicas.',
        topics: featTopics(t('cps3'), 'resfriamento'),
        statusAtual: null,
        allowedStatuses: ['espera', 'falha', 'manutencao'],
      },
      {
        key: 'monitoramento_condicao',
        nome: 'Monitoramento de Condição',
        descricao: 'Vibração/pressão para manutenção preditiva.',
        topics: featTopics(t('cps3'), 'monitoramento_condicao'),
        statusAtual: null,
        allowedStatuses: ['espera', 'falha', 'manutencao'],
      },
    ],
  },

  // CPS-004 ---------------------------------------------------------
  {
    id: 'CPS-004',
    nome: 'AGV_Logistico_Zeta',
    descricao:
      'AGV para logística interna com navegação SLAM, monitoramento de obstáculos e diagnóstico de motores em tempo real.',
    sensores: [
      'Bateria',               // %
      'Velocidade',            // m/s
      'Posicao_Mapa',          // x,y
      'Distancia_Obstaculo',   // m
      'Status_Motor_Tração',   // corrente/temperatura/torque
    ],
    operacoes:
      'Pickup, Delivery, Docking, Desvio de Obstáculos, Monitoramento de Trilha',
    status: 'Em_Rota',
    topic: t('cps4'),
    server: 'broker.hivemq.com',
    port: 8884,
    client: 'Python',

    funcionalidades: [
      {
        key: 'navegacao',
        nome: 'Navegação',
        descricao: 'Localização e planejamento de rota (SLAM).',
        topics: featTopics(t('cps4'), 'navegacao'),
        statusAtual: null,
        allowedStatuses: ['espera', 'falha', 'manutencao'],
      },
      {
        key: 'pickup_delivery',
        nome: 'Pickup & Delivery',
        descricao: 'Aproximação, carga e descarga em estações.',
        topics: featTopics(t('cps4'), 'pickup_delivery'),
        statusAtual: null,
        allowedStatuses: ['espera', 'falha', 'manutencao'],
      },
      {
        key: 'docking',
        nome: 'Docking',
        descricao: 'Acoplamento em docas de recarga/transferência.',
        topics: featTopics(t('cps4'), 'docking'),
        statusAtual: null,
        allowedStatuses: ['espera', 'falha', 'manutencao'],
      },
    ],
  },

  // CPS-005 ---------------------------------------------------------
  {
    id: 'CPS-005',
    nome: 'SistemaVisao_Qualit',
    descricao:
      'Sistema de visão artificial para inspeção de qualidade em linha, com análise de defeitos, monitoramento de iluminação e performance de processamento.',
    sensores: [
      'Luminosidade_Ambiente',   // lux
      'Temperatura_Camera',      // °C
      'Tempo_Processamento',     // ms
      'Foco_Lente',              // %
      'Taxa_Quadros_Processados' // FPS
    ],
    operacoes:
      'Inspeção, Rejeição automática, Ajuste de foco dinâmico, Controle de iluminação',
    status: 'Inspecionando',
    topic: t('cps5'),
    server: 'broker.hivemq.com',
    port: 8884,
    client: 'ESP32',

    funcionalidades: [
      {
        key: 'inspecao',
        nome: 'Inspeção de Defeitos',
        descricao: 'Classificação e medição de não-conformidades.',
        topics: featTopics(t('cps5'), 'inspecao'),
        statusAtual: null,
        allowedStatuses: ['espera', 'falha', 'manutencao'],
      },
      {
        key: 'rejeicao_auto',
        nome: 'Rejeição Automática',
        descricao: 'Atuação em esteira para descarte.',
        topics: featTopics(t('cps5'), 'rejeicao_auto'),
        statusAtual: null,
        allowedStatuses: ['espera', 'falha', 'manutencao'],
      },
      {
        key: 'controle_iluminacao',
        nome: 'Controle de Iluminação',
        descricao: 'Ajuste de intensidade/tempo de estrobos.',
        topics: featTopics(t('cps5'), 'controle_iluminacao'),
        statusAtual: null,
        allowedStatuses: ['espera', 'falha', 'manutencao'],
      },
    ],
  },
];

// Mapeia por nome (case-insensitive)
export const cpsDatabase = initialCPSList.reduce((acc, cps) => {
  acc[cps.nome.toLowerCase()] = cps;
  return acc;
}, {});

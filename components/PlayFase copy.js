'use client';

import React, { useMemo, useState } from 'react';
import { useCPSContext } from '../context/CPSContext';

// ===== Helpers =====
const mapFeatStatusToBadgeClass = (status) => {
  const s = String(status || '').toLowerCase();
  if (s === 'falha') return 'feat-badge feat-falha';
  if (s === 'manutencao') return 'feat-badge feat-manutencao';
  if (['espera', 'ativo', 'active', 'ok', 'rodando'].includes(s)) return 'feat-badge feat-ativo';
  return 'feat-badge';
};

const humanizeFeatStatus = (status) => {
  const s = String(status || '').toLowerCase();
  if (s === 'falha') return 'Falha';
  if (s === 'manutencao') return 'Em Manutenção';
  if (['espera', 'ativo', 'active', 'ok', 'rodando'].includes(s)) return 'Ativo';
  return '—';
};

// ===== Lógica de agrupamento de alertas =====
const isFeatureAlert = (a) => a?.raw?.type === 'feature_state';
const getCpsKey = (a) => a?.cpsId || a?.cpsName || 'unknown';
const tsOf = (a) => {
  const t = a?.timestamp || a?.raw?.timestamp;
  const n = Number.isFinite(t) ? t : Date.parse(t);
  return Number.isFinite(n) ? n : 0;
};
const groupAlertsByCPS = (alerts = []) => {
  const grouped = alerts.reduce((acc, a) => {
    const key = getCpsKey(a);
    (acc[key] ||= []).push(a);
    return acc;
  }, {});
  Object.values(grouped).forEach((list) => list.sort((a, b) => tsOf(b) - tsOf(a)));
  return grouped;
};
const latestAlertPerCPS = (alerts = []) => {
  const groups = groupAlertsByCPS(alerts);
  return Object.fromEntries(Object.entries(groups).map(([k, list]) => [k, list[0]]));
};

// ===== Componente principal =====
const PlayFase = () => {
  const {
    addedCPS,
    alerts = [],
    startCPSById,
    stopCPSById,
    showCPSDescription,
    acknowledgeAlert,
    unplugCPS, // 👈 necessário para o botão "Sair"
  } = useCPSContext();

  // cache de último alerta
  const latestByCps = useMemo(() => {
    const featureAlerts = alerts.filter(isFeatureAlert);
    return latestAlertPerCPS(featureAlerts);
  }, [alerts]);

  // estado modal
  const [modalOpen, setModalOpen] = useState(false);
  const [modalCpsName, setModalCpsName] = useState('');
  const [modalAlert, setModalAlert] = useState(null);
  const [activeTab, setActiveTab] = useState('details');

  const openDetails = (cps) => {
    const key = cps.id || cps.nome;
    const a = latestByCps[key] || null;
    setModalCpsName(cps.nome);
    setModalAlert(a);
    setActiveTab('details');
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setModalAlert(null);
    setModalCpsName('');
  };

  const handleAck = () => {
    if (modalAlert?.id) {
      acknowledgeAlert?.(modalAlert.id);
      closeModal();
    }
  };

  const handleExit = async (cps) => {
    try {
      await Promise.resolve(unplugCPS(cps.nome));
    } catch (e) {
      alert(`Falha ao remover CPS: ${e?.message || e}`);
    }
  };

  const copyJSON = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(modalAlert?.raw || modalAlert || {}, null, 2));
      alert('JSON copiado para a área de transferência.');
    } catch {
      alert('Não foi possível copiar o JSON.');
    }
  };

  return (
    <div className="component-container play-fase">
      <h2>Play Fase</h2>

      {/* === CPS ATIVOS === */}
      <div className="added-cps-display-play">
        <h3>CPS Ativos:</h3>
        <ul className="cps-list-play">
          {addedCPS.length > 0 ? (
            addedCPS.map((cps) => (
              <li
                key={cps.id}
                className={`cps-item-play status-${String(cps.status || '').toLowerCase()}`}
              >
                <div className="cps-header">
                  <span className="cps-name">
                    {cps.nome} — <strong>{cps.status}</strong>
                  </span>

                  <div className="action-buttons">
                    <button
                      onClick={() => stopCPSById(cps.id)}
                      disabled={cps.status === 'Parado'}
                      className="stop-btn"
                    >
                      Parar
                    </button>
                    <button
                      onClick={() => startCPSById(cps.id)}
                      disabled={cps.status === 'Rodando'}
                      className="restart-btn"
                    >
                      Reiniciar
                    </button>
                    <button
                      onClick={() => showCPSDescription(cps.nome)}
                      className="desc-btn"
                    >
                      Descrição
                    </button>
                    <button
                      className="restart-btn"
                      title="Ver detalhes do último alerta deste CPS"
                      onClick={() => openDetails(cps)}
                    >
                      Detalhes
                    </button>
                   {/* Sair — só aparece se o CPS estiver Parado */}
                    {String(cps.status).toLowerCase() === 'parado' && (
                      <button
                        className="exit-btn"
                        title="Desligar e remover este CPS"
                        onClick={() => handleExit(cps)}
                      >
                        Sair
                      </button>
                    )}  
                  </div>
                </div>                

                {/* === Funcionalidades === */}
                <div className="func-table">
                  <div className="func-table-header">
                    <div>Funcionalidade</div>
                    <div>Status</div>
                    <div>Última atualização</div>
                    <div>Detalhes</div>
                  </div>

                  {(cps.funcionalidades || []).map((f) => {
                    const human = humanizeFeatStatus(f.statusAtual);
                    const badgeCls = mapFeatStatusToBadgeClass(f.statusAtual);
                    const when = f.lastUpdate ? new Date(f.lastUpdate).toLocaleString() : '—';
                    const details = f.lastDetails
                      ? Object.entries(f.lastDetails)
                          .slice(0, 3)
                          .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
                          .join(' • ')
                      : '—';

                    return (
                      <div key={f.key} className="func-row">
                        <div className="func-name">{f.nome}</div>
                        <div><span className={badgeCls}>{human}</span></div>
                        <div className="func-time">{when}</div>
                        <div className="func-details">{details}</div>
                      </div>
                    );
                  })}
                </div>
              </li>
            ))
          ) : (
            <li className="no-cps">Nenhum CPS ativo.</li>
          )}
        </ul>
      </div>

      {/* ===== Modal de Detalhes de Alerta ===== */}
      {modalOpen && (
        <div className="modal-overlay" role="presentation" onClick={closeModal}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="alert-details-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="alert-details-title" className="details-modal-title">
              Detalhes — {modalCpsName}
            </h3>

            {!modalAlert ? (
              <div className="no-alerts" style={{ marginTop: 4 }}>
                Sem alertas recentes para este CPS.
              </div>
            ) : (
              <>
                <div className="details-tabs">
                  <button
                    className={`tab-btn ${activeTab === 'details' ? 'active' : ''}`}
                    onClick={() => setActiveTab('details')}
                  >
                    Detalhes
                  </button>
                  <button
                    className={`tab-btn ${activeTab === 'json' ? 'active' : ''}`}
                    onClick={() => setActiveTab('json')}
                  >
                    JSON
                  </button>
                </div>

                {activeTab === 'details' ? (
                  <div className="details-grid">
                    <div><strong>Funcionalidade</strong></div>
                    <div>{modalAlert.component || modalAlert.raw?.featKey || '—'}</div>

                    <div><strong>Status</strong></div>
                    <div>{humanizeFeatStatus(modalAlert.raw?.status)}</div>

                    <div><strong>Quando</strong></div>
                    <div>{new Date(modalAlert.timestamp).toLocaleString()}</div>

                    <div><strong>Detalhes</strong></div>
                    <div className="details-box">
                      {modalAlert.raw?.details
                        ? Object.entries(modalAlert.raw.details)
                            .map(([k, v]) => (
                              <div key={k}>
                                {k}: {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                              </div>
                            ))
                        : '—'}
                    </div>
                  </div>
                ) : (
                  <pre className="json-pre">
                    {JSON.stringify(modalAlert.raw || modalAlert, null, 2)}
                  </pre>
                )}
              </>
            )}

            <div className="modal-footer">
              <button className="modal-cancel-btn" onClick={closeModal}>Fechar</button>
              {modalAlert && (
                <>
                  {activeTab === 'json' && (
                    <button className="desc-btn" onClick={copyJSON} title="Copiar JSON">
                      Copiar JSON
                    </button>
                  )}
                  <button className="modal-confirm-btn" onClick={handleAck} title="Reconhecer e remover alerta">
                    Reconhecer
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PlayFase;

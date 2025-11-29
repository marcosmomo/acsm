'use client';

import React, { useRef, useState, useMemo } from 'react';
import { useCPSContext } from '../context/CPSContext';

const PlugFase = () => {
  const {
    availableCPSNames = [],
    registerCPS,
    addCPS,
    addedCPS,
    unplugCPS,
  } = useCPSContext();

  const fileInputRef = useRef(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handlePickFile = () => fileInputRef.current?.click();

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatusMsg('');
    setErrorMsg('');

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = String(evt.target?.result || '');
        const parsed = JSON.parse(text);

        const ok = registerCPS(parsed);

        if (ok) {
          setStatusMsg('CPS carregado(s) para a Fase Plug.');
        } else {
          setErrorMsg('Falha ao carregar CPS para a Fase Plug. Verifique os logs.');
        }
      } catch {
        setErrorMsg('JSON inválido. Use o modelo (AAS) conforme o model.json.');
      } finally {
        e.target.value = '';
      }
    };
    reader.onerror = () => {
      setErrorMsg('Não foi possível ler o arquivo.');
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  // Conjunto com os nomes dos CPS que já estão na Fase Play
  const cpsNamesInPlay = useMemo(
    () => new Set((addedCPS || []).map((cps) => cps.nome)),
    [addedCPS]
  );

  return (
    <div className="component-container plug-fase">
      <h2>Plug Phase</h2>

      {/* Ações principais */}
      <div className="button-group" style={{ marginBottom: 12 }}>
        <button type="button" onClick={handlePickFile}>
          Carregar arquivo JSON
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          onChange={handleFileChange}
          style={{ display: 'none' }}
          aria-label="Selecionar arquivo JSON de CPS"
        />
      </div>

      {/* Mensagens */}
      {statusMsg ? (
        <div className="added-cps-section" role="status">
          {statusMsg}
        </div>
      ) : null}

      {errorMsg ? (
        <div
          className="added-cps-section"
          role="alert"
          style={{ backgroundColor: '#fdeaea', borderColor: '#f5c2c7' }}
        >
          {errorMsg}
        </div>
      ) : null}

      {/* Lista de CPS na Fase Plug */}
      <div className="added-cps-section" style={{ marginTop: 12 }}>
        <h3>CPS na Fase Plug:</h3>
        <ul className="cps-list">
          {availableCPSNames.length ? (
            availableCPSNames.map((name) => {
              const inPlay = cpsNamesInPlay.has(name);

              return (
                <li key={name} className="cps-item-plug cps-item-plug-row">
                  {name}

                  {inPlay ? (
                    <button
                      className="exit-btn"
                      style={{ marginLeft: 8 }}
                      onClick={() => unplugCPS(name)}
                      title={`Remover ${name} da Fase Play e da arquitetura`}
                    >
                      Unplug
                    </button>
                  ) : (
                    <button
                      className="start-ops-btn"
                      style={{ marginLeft: 8 }}
                      // 👇 agora entra em Play já rodando e mandando "iniciar operações"
                      onClick={() => addCPS(name)} 
                      // ou: onClick={() => addCPS(name, { startAfterPlug: true })}
                      title={`Mover ${name} para a Fase Play e iniciar operações`}
                    >
                      Play
                    </button>
                  )}
 </li>
              );
            })
          ) : (
            <li className="no-cps">
              Nenhum CPS na Fase Plug. Carregue um JSON primeiro.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
};

export default PlugFase;

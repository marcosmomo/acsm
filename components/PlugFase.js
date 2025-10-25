'use client';
import React, { useEffect, useRef, useState } from 'react';
import { useCPSContext } from '../context/CPSContext';

const PlugFase = () => {
  const {
    availableCPSNames,
    addedCPS,
    addCPS,
    unplugCPS,
    startCPSById,
  } = useCPSContext();

  const [searchText, setSearchText] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);

  const [selectedName, setSelectedName] = useState(null);
  const [operationsStarted, setOperationsStarted] = useState(false);
  const [opsLoading, setOpsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Modal
  const [confirmOpen, setConfirmOpen] = useState(false);
  const confirmBtnRef = useRef(null);
  const startOpsBtnRef = useRef(null);

  // Refs de UI
  const inputRef = useRef(null);
  const inputGroupRef = useRef(null);

  useEffect(() => {
    if (confirmOpen) setTimeout(() => confirmBtnRef.current?.focus(), 0);
  }, [confirmOpen]);

  useEffect(() => {
    const onDocMouseDown = (e) => {
      const group = inputGroupRef.current;
      if (!group) return;
      if (!group.contains(e.target)) {
        setSuggestionsOpen(false);
        setHighlightIndex(-1);
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('mousedown', onDocMouseDown);
      return () => document.removeEventListener('mousedown', onDocMouseDown);
    }
  }, []);

  const updateSuggestions = (value) => {
    if (value.length > 0) {
      const q = value.toLowerCase();
      const filtered = (availableCPSNames || []).filter((name) =>
        name.toLowerCase().includes(q)
      );
      setSuggestions(filtered);
      setSuggestionsOpen(filtered.length > 0);
      setHighlightIndex(filtered.length ? 0 : -1);
    } else {
      setSuggestions([]);
      setSuggestionsOpen(false);
      setHighlightIndex(-1);
    }
  };

  const handleSearchChange = (event) => {
    const value = event.target.value;
    setSearchText(value);
    setSelectedName(null);
    updateSuggestions(value);
  };

  const handleAddCPS = async (forceName) => {
    const name = (forceName ?? searchText).trim();
    if (!name) return;

    try {
      await Promise.resolve(addCPS(name, { startAfterPlug: operationsStarted }));
    } catch (e) {
      setError(e?.message || 'Falha ao adicionar CPS.');
      return;
    } finally {
      setSearchText('');
      setSuggestions([]);
      setSuggestionsOpen(false);
      setHighlightIndex(-1);
      setSelectedName(null);
      inputRef.current?.focus();
    }
  };

  const handleUnplugCPS = async () => {
    const target = (selectedName ?? searchText).trim();
    if (!target) return;
    try {
      await unplugCPS(target);
      setSearchText('');
      setSuggestions([]);
      setSuggestionsOpen(false);
      setHighlightIndex(-1);
      setSelectedName(null);
    } catch (e) {
      setError(e?.message || 'Falha ao desligar/remover CPS.');
    }
  };

  const handleSelectFromList = (name) => {
    setSelectedName(name);
    setSearchText(name);
    setSuggestionsOpen(false);
  };

  const onInputKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      if (!suggestionsOpen && suggestions.length) setSuggestionsOpen(true);
      setHighlightIndex((i) => Math.min(i + 1, suggestions.length - 1));
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      if (!suggestionsOpen && suggestions.length) setSuggestionsOpen(true);
      setHighlightIndex((i) => Math.max(i - 1, 0));
      e.preventDefault();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (suggestionsOpen && highlightIndex >= 0 && suggestions[highlightIndex]) {
        handleAddCPS(suggestions[highlightIndex]);
      } else {
        handleAddCPS();
      }
    } else if (e.key === 'Escape') {
      setSuggestionsOpen(false);
      setHighlightIndex(-1);
    }
  };

  // Modal
  const openConfirm = () => {
    if (operationsStarted || opsLoading || addedCPS.length === 0) return;
    setConfirmOpen(true);
  };
  const closeConfirm = () => {
    setConfirmOpen(false);
    setTimeout(() => startOpsBtnRef.current?.focus(), 0);
  };
  const onDialogKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeConfirm(); }
    else if (e.key === 'Enter') { e.preventDefault(); doStartOperations(); }
  };

  const doStartOperations = async () => {
    if (operationsStarted || opsLoading) return;
    setError(null);
    setOpsLoading(true);
    try {
      const toStart = addedCPS.filter(
        (c) => String(c?.status || '').toLowerCase() !== 'rodando'
      );
      for (const cps of toStart) {
        try { await Promise.resolve(startCPSById(cps.id)); }
        catch (e) { console.warn('Falha ao iniciar CPS:', cps?.nome, e); }
      }
      setOperationsStarted(true);
      setConfirmOpen(false);
      setTimeout(() => startOpsBtnRef.current?.focus(), 0);
    } catch (e) {
      setError(e?.message || 'Falha ao iniciar operações.');
    } finally {
      setOpsLoading(false);
    }
  };

  const canSubmitText = Boolean(searchText.trim());
  const canRemove = Boolean((selectedName ?? searchText).trim());

  return (
    <div className="component-container plug-fase">
      <h2>Plug Fase</h2>

      <div className="input-group" ref={inputGroupRef}>
        <input
          ref={inputRef}
          type="text"
          placeholder="Buscar CPS pelo nome..."
          value={searchText}
          onChange={handleSearchChange}
          onKeyDown={onInputKeyDown}
          className="autocomplete-input"
          aria-label="Buscar CPS pelo nome"
          aria-autocomplete="list"
          aria-expanded={suggestionsOpen}
        />
        {suggestionsOpen && suggestions.length > 0 && (
          <ul className="suggestions-list" role="listbox">
            {suggestions.map((name, idx) => (
              <li
                key={name}
                role="option"
                aria-selected={idx === highlightIndex}
                className={idx === highlightIndex ? 'highlight' : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleAddCPS(name)}
                title={`Adicionar ${name}`}
              >
                {name}
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <div role="alert" className="error" style={{ marginBottom: 8 }}>
          {error}
        </div>
      )}

      <div className="button-group">
        <button onClick={() => handleAddCPS()} disabled={!canSubmitText}>
          Adicionar CPS
        </button>

        <button
          type="button"
          ref={startOpsBtnRef}
          onClick={openConfirm}
          disabled={operationsStarted || opsLoading || addedCPS.length === 0}
          className="start-ops-btn"
          title={
            operationsStarted
              ? 'Operações já iniciadas'
              : addedCPS.length === 0
              ? 'Adicione pelo menos um CPS para iniciar'
              : 'Inicia operações para todos os CPS plugados (com confirmação)'
          }
        >
          {opsLoading
            ? 'Iniciando...'
            : operationsStarted
            ? 'Operações iniciadas'
            : 'Iniciar Operações'}
        </button>

        <button onClick={handleUnplugCPS} disabled={!canRemove}>
          Desligar e Remover (Unplug)
        </button>
      </div>

      {/* REMOVIDO: banner "Selecionado para remover: ... Limpar" */}

      <div className="added-cps-section" style={{ marginTop: 12 }}>
        <h3>CPS Adicionados:</h3>
        <ul className="cps-list">
          {addedCPS.length > 0 ? (
            addedCPS.map((cps) => {
              const name = cps.nome;
              const isSelected = selectedName === name;
              return (
                <li
                  key={cps.id}
                  className={`cps-item-plug ${isSelected ? 'selected' : ''} cps-item-plug-row`}
                  onClick={() => handleSelectFromList(name)}
                  aria-selected={isSelected}
                  title={isSelected ? 'Selecionado para remover' : 'Clique para selecionar para remoção'}
                >
                  {name} — Status: <strong>{cps.status}</strong>
                </li>
              );
            })
          ) : (
            <li className="no-cps">Nenhum CPS adicionado.</li>
          )}
        </ul>
      </div>

      {confirmOpen && (
        <div className="modal-overlay" role="presentation" onClick={closeConfirm}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="start-ops-title"
            aria-describedby="start-ops-desc"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={onDialogKeyDown}
          >
            <h3 id="start-ops-title">Iniciar operações?</h3>
            <p id="start-ops-desc" style={{ marginTop: 6 }}>
              Isso enviará o comando <em>“iniciar operações”</em> para todos os CPS plugados que não estão rodando.
            </p>
            <div className="modal-actions">
              <button onClick={closeConfirm} className="modal-cancel-btn">Cancelar</button>
              <button ref={confirmBtnRef} onClick={doStartOperations} className="modal-confirm-btn">Confirmar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PlugFase;

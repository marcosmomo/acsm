'use client';
import React, { useEffect, useRef, useState } from 'react';
import { useCPSContext } from '../context/CPSContext';

const PlugFase = () => {
  const {
    availableCPSNames,
    addedCPS,
    addCPS,
    startCPSById,
  } = useCPSContext();

  const [searchText, setSearchText] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);

  const [selectedName, setSelectedName] = useState(null);   
  const [error, setError] = useState(null);

  
  // Refs de UI
  const inputRef = useRef(null);
  const inputGroupRef = useRef(null);

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
      await Promise.resolve(addCPS(name, { startAfterPlug: false }));
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


  const handleSelectFromList = (name) => {
    setSelectedName(name);
    setSearchText(name);
    setSuggestionsOpen(false);
    
    // Clique = autorização + iniciar operações
    const target = addedCPS.find((c) => c.nome === name);
    if (target && String(target.status).toLowerCase() !== 'rodando') {
      // chama o start e deixa o subscription automático cuidar dos tópicos
      try { startCPSById(target.id); } catch {}
    }
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

 
  const canSubmitText = Boolean(searchText.trim());
  return (
    <div className="component-container plug-fase">
      <h2>Plug Phase</h2>

      <div className="input-group" ref={inputGroupRef}>
        <input
          ref={inputRef}
          type="text"
          placeholder="Search by name..."
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
          Add CPS
        </button>        
      </div>

      {/* REMOVIDO: banner "Selecionado para remover: ... Limpar" */}

      <div className="added-cps-section" style={{ marginTop: 12 }}>
        <h3>CPS presented:</h3>
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
    </div>
  );
};

export default PlugFase;

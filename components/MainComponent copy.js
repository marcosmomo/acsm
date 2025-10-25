// /components/MainComponent.js
'use client';

import React from 'react';
import PlugFase from './PlugFase';
import PlayFase from './PlayFase';
import { CPSProvider } from '../context/CPSContext';
import '../styles/globals.css'; 

const MainComponent = () => {
  return (
    <CPSProvider>
      <div className="full-screen-app">
        <header className="main-header">
          <h1>Arquitetura de Controle para Sistemas de Manufatura baseado em CPS</h1>
        </header>
        <main className="main-content-split">
          <div className="plug-fase-wrapper">
            <PlugFase />
          </div>
          <div className="play-fase-wrapper">
            <PlayFase />
          </div>
        </main>
      </div>
    </CPSProvider>
  );
};

export default MainComponent;

// /components/MainComponent.js
'use client';

import React from 'react';
import PlugFase from './PlugFase';
import PlayFase from './PlayFase';
import { CPSProvider } from '../context/CPSContext';
import '../styles/globals.css'; 
import { Settings, Cpu } from "lucide-react"


const MainComponent = () => {
  return (
    <CPSProvider>
      <div className="full-screen-app">
        <header className="main-header">
        <div className="flex items-start sm:items-center gap-3 sm:gap-4">
                <div className="h-12 w-12 sm:h-14 sm:w-14 rounded-xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-lg shadow-primary/20 ring-2 ring-primary/10">
                  <Cpu className="h-6 w-6 sm:h-7 sm:w-7 text-primary-foreground" />
                </div>
                <div className="flex-1">
                  <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-foreground text-balance leading-tight">
                    Architecture for Manufacturing Systems
                  </h1>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
                      <Settings className="h-3 w-3" />
                      CPS
                    </span>
                    <p className="text-xs sm:text-sm text-muted-foreground">Cyber-Physical Systems</p>
                  </div>
                </div>
              </div>
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

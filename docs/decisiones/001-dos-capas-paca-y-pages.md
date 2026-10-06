# 001 — Dos capas sobre un único archivo de datos

Fecha: 2026-10-05 · Estado: vigente

## Contexto

El encargo pedía usar [Paca](https://github.com/Paca-AI/paca) como plataforma de
gestión y, a la vez, publicar el tablero de seguimiento en GitHub Pages.

## El hecho que obliga la decisión

Paca es una plataforma autohospedada: cuatro servicios en Go (`api`, `realtime`,
`agent-server`, `agent-runner`), PostgreSQL y una aplicación React servida
detrás de Caddy. GitHub Pages sirve archivos estáticos y nada más.

**Paca no se puede desplegar en GitHub Pages.** No es una limitación de
configuración; es una incompatibilidad de arquitectura.

## Decisión

En lugar de sacrificar una de las dos partes, el repositorio sostiene dos capas
sobre una única fuente de verdad, `data/board.json`:

```
Paca (autohospedado, interactivo)  ──sync──▶  data/board.json  ──build──▶  GitHub Pages
            ▲                                       │
            └──────────────── seed ─────────────────┘
```

- **Paca** es el tablero operativo donde el equipo y los agentes mueven tarjetas.
- **Pages** publica el espejo de lectura, sin servidor ni base de datos.
- `paca/seed.mjs` siembra el tablero; `paca/sync.mjs` trae el estado de vuelta.

## Consecuencias

- Publicar un cambio pasa por un commit. Es deliberado: cada cambio del tablero
  público queda revisable en la historia.
- El sitio no tiene dependencias en tiempo de ejecución ni de construcción, así
  que sigue funcionando desde cualquier servidor estático mientras exista el
  archivo de datos.
- `lib/board.mjs` lo importan el sitio, la verificación de CI y los scripts de
  Paca sin copia intermedia, de modo que el tablero no puede discrepar de la
  verificación sobre qué significan los datos.

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| Desplegar Paca en Pages | Imposible: requiere servidor y base de datos |
| Publicar solo el SPA de Paca | Quedaría sin API; un tablero vacío |
| Renunciar a Pages y dejar solo Paca | El encargo pide un tablero público y Paca exige credenciales |

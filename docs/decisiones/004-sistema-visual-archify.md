# 004 — Sistema visual Archify y acentos semánticos

Fecha: 2026-10-05 · Estado: vigente

## Contexto

El tablero debía seguir el lenguaje visual de Archify, el generador de diagramas
usado en el resto de los artefactos del equipo.

## Qué se adoptó

| Rasgo | Valor |
|---|---|
| Base | `#020617` oscuro, `#f4f5f7` claro |
| Lienzo | Retícula punteada de 20 px, un píxel por nodo |
| Panel | Translúcido, radio `0.75rem`, borde de 1 px |
| Escala de texto | `--text`, `--text-muted`, `--text-faint`, `--text-dim` |
| Monoespaciada | JetBrains Mono para claves, códigos y cifras |
| Acentos | Siete familias semánticas con par relleno/trazo |

## La decisión que cambió los datos

Archify resuelve **cada familia de acento a un color distinto por tema**. El
tablero guardaba un hexadecimal literal por fase, de modo que en tema claro
habría conservado el color del tema oscuro.

Por eso `epics[].color` dejó de ser un hexadecimal y pasó a nombrar una familia
semántica que el CSS resuelve. Una prueba rechaza explícitamente un hexadecimal
literal para que no vuelva a entrar.

```json
{ "key": "F1", "color": "database" }
```

Mapeo vigente:

| Fase | Familia | Razón |
|---|---|---|
| F1 Base de datos probatoria | `database` | el acervo probatorio |
| F2 Conciliación y tablero | `frontend` | la superficie de consulta |
| F3 Copiloto con evidencia | `backend` | los servicios de recuperación y verificación |
| F4 Despliegue institucional | `cloud` | infraestructura |
| TR Transversal | `external` | atraviesa todo, fuera de la cadena de entrega |

`accentVar` devuelve el acento de énfasis cuando la familia falta o es
desconocida: una propiedad personalizada inexistente pintaría el elemento
transparente, y un error tipográfico no debe borrar una barra.

## Conmutación de tema

El tema se fija con `[data-theme]` en `<html>`, no solo con una media query. El
tablero se proyecta en salas cuya iluminación no coincide con la preferencia del
sistema, así que la elección tiene que estar al alcance y persistir.

Un script en línea la resuelve **antes del primer pintado**; sin él, quien usa
tema claro vería un destello oscuro en cada navegación.

## Un defecto que encontró la vista, no las pruebas

Con toda la suite en verde, las capturas mostraron que el porcentaje dentro de
las barras rayadas era ilegible en ambos temas: blanco sobre rayas claras en
oscuro, oscuro sobre tono medio en claro.

Ahora la cifra viaja en su propia cápsula, con el fondo del tema y el color de
la barra como texto. Ninguna prueba automática iba a detectarlo.

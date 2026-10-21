---
name: configurar-{{ID}}
description: "Sets up the {{NAME}} module of AI Ecosystem. Use when a session-start notice asks for it or when the user asks to configure {{NAME}}."
---

# Set up {{NAME}}

This module brings no questions of its own. The setup checks what the plugin detected, saves the answers the module accepts and finishes.

Prerequisite: the core (`ai-ecosystem`) set up. If `pre_requisitos` shows it is not, run the `configurar-ai-ecosystem` skill first and come back.

{{COMMON}}

## Module questions

Follow the `perguntas` list of the status. If it comes back empty, show in the summary what the module detected (`detectado.modulo`) and ask only for the confirmation to finish.

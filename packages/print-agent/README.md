# Agente de impresión ZentoFact

Programa de la PC de empaque. El navegador no habla con la impresora. Este proceso sí.

Arranca cuando enciendes la computadora, se conecta al API, y recién entonces imprime.

## Reglas

- 1, 2 o 3 etiquetas esperan.
- 4 etiquetas: una hoja A4.
- 7 u 8: dos hojas, también se imprimen.
- Si no se juntan 4, a la hora se imprime lo que haya.
- Si alguien imprimió en la bandeja, ese pedido no sale otra vez.
- Con la PC apagada no se imprime nada. Los pedidos se quedan en cola.

## Instalar en la PC de empaque (macOS)

1. En Ajustes, activa impresión automática y copia el token.
2. En esa Mac:

```bash
cd packages/print-agent
node src/index.js list-printers
node src/index.js --api https://TU-API --token zfprint_… --printer "Nombre CUPS" --dry-run --once
node src/index.js install-login --api https://TU-API --token zfprint_… --printer "Nombre CUPS"
launchctl load -w ~/Library/LaunchAgents/pe.zentofact.print-agent.plist
```

`--dry-run` escribe el PDF en `~/.zentofact-print` y no manda papel.

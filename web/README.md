# Painel web do SaaS de clínicas

Interface React 19 + TypeScript + Vite para login, agenda nativa, pacientes, inbox, integração Uno, campanhas, automações, rascunhos IA e resumo do ciclo/plano.

## Desenvolvimento

Na raiz do workspace, rode `npm install` e depois `npm run dev`. Para apontar a API a outro endereço, defina `VITE_API_URL` (sem `/api` final); por padrão usa `http://localhost:3002`.

## Build

```powershell
npm run build --workspace web
```

O painel é um MVP funcional. Não substitui autorização do backend; conectores de WhatsApp e envio externo estão desabilitados. A configuração da IA declara processamento autorizado pelo administrador, mas a clínica ainda precisa avaliar a base legal, contratos e retenção antes de habilitar dados reais.

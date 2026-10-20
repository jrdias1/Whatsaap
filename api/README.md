# API do SaaS de clínicas

API NestJS 12 com Prisma 6 e PostgreSQL. Os módulos implementados e suas limitações estão em [PLANO_PROJETO.md](../PLANO_PROJETO.md) e [REGISTRO_IMPLEMENTACAO.md](../docs/REGISTRO_IMPLEMENTACAO.md).

## Desenvolvimento local

Na raiz do workspace, instale as dependências com `npm install`. Copie `api/.env.example` para `api/.env`, ajuste segredos locais e suba o PostgreSQL definido em `docker-compose.yml`.

```powershell
npm run db:generate --workspace api
npm run db:migrate --workspace api
npm run dev
```

A API fica em `http://localhost:3002/api`; o health check é `GET /api/health`. O painel Vite usa `http://localhost:5173`.

## Planos/ciclo local

```powershell
npm run db:seed-plans --workspace api
npm run db:seed-plans --workspace api -- --tenant-slug <slug> --plan STARTER
```

O segundo comando inicia um ciclo local `TRIAL` de 30 dias para o tenant indicado; não cobra, não integra gateway e não deve ser usado como renovação de assinatura. Planos e limites são propostas do MVP.

## Verificação

```powershell
npm run lint --workspace api
npm run build --workspace api
npm run test:e2e --workspace api
```

Os E2E PostgreSQL usam o banco de desenvolvimento configurado em `DATABASE_URL` e limpam os tenants/fixtures próprios. Não execute contra banco de cliente ou produção.

## Limites operacionais

Envio Meta/Evolution, worker de mensagens, autonomia de IA, escrita/sincronização Uno, cobrança recorrente, backup/restore de produção e provisionamento web do primeiro Superadmin não estão habilitados.

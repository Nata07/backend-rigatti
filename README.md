# Mini SaaS Backend - API REST

Backend Node.js + TypeScript com autenticação JWT, multi-tenant, MongoDB, Redis, OpenAI e email.

## Stack Tecnológica

- **Runtime**: Node.js 20
- **Framework**: Express 5
- **Linguagem**: TypeScript (com loaders dinâmicos)
- **Banco de Dados**: MongoDB 8
- **Cache/Rate Limiting**: Redis 7
- **IA**: OpenAI API (GPT-4o-mini)
- **Email**: Nodemailer (SMTP)
- **Logs**: Pino (JSON estruturado)
- **Testes**: Jest
- **Validação**: Zod

## Funcionalidades

### Autenticação
- Registro e login com JWT
- Roles: `admin` e `user`
- Password reset via email
- Verificação de email obrigatória
- Rate limiting em endpoints de auth

### Multi-Tenant
- Isolamento completo por empresa (`companyId`)
- Dados nunca vazam entre tenants
- Context extraído do JWT

### Produtos
- CRUD completo de produtos
- Upload de imagens (armazenamento local)
- Busca por nome e categoria
- Apenas admins podem criar/editar/deletar

### Chat com IA
- Integração com OpenAI
- Tool calling para buscar produtos reais
- Streaming via Server-Sent Events (SSE)
- Histórico de conversas persistido

### Rate Limiting
- Login: 5 req/min por IP
- Register: 3 req/min por IP
- Chat: 20 req/min por usuário
- Stream: 10 conexões simultâneas por usuário
- Admins têm bypass automático

### Logs e Monitoramento
- Logs JSON estruturados com Pino
- Request ID tracking
- Redação automática de dados sensíveis
- Health check em `/health`

## Requisitos

- Node.js 20+
- Docker e Docker Compose (para execução com containers)
- MongoDB 8+ (se rodar manualmente)
- Redis 7+ (se rodar manualmente)
- Chave da OpenAI API

## Setup Rápido com Docker

### 1. Configurar variáveis de ambiente

```powershell
Copy-Item .env.example .env
```

Edite `.env` e preencha:
- `OPENAI_API_KEY` - **obrigatório**
- `JWT_SECRET` - mínimo 32 caracteres
- `MONGO_ROOT_PASSWORD` - senha do MongoDB
- `REDIS_PASSWORD` - senha do Redis
- `SMTP_*` - configurações de email (opcional para teste)

### 2. Iniciar com Docker Compose

```powershell
docker compose up -d
```

Isso vai iniciar:
- MongoDB na porta 27017
- Redis na porta 6379
- Backend na porta 3001

### 3. Popular banco com dados de teste

```powershell
# Executar seed dentro do container
docker compose exec backend npm run seed
```

### 4. Testar API

```powershell
# Health check
curl http://localhost:3001/health

# Login
curl -X POST http://localhost:3001/api/auth/login `
  -H "Content-Type: application/json" `
  -d '{\"email\":\"admin@techcorp.com\",\"password\":\"Admin123!\"}'
```

## Setup Manual (Desenvolvimento)

### 1. Instalar dependências

```powershell
npm install
```

### 2. Configurar .env

```powershell
Copy-Item .env.example .env
```

Preencha as variáveis (veja seção "Variáveis de Ambiente" abaixo).

### 3. Iniciar MongoDB e Redis

Você precisa ter MongoDB e Redis rodando localmente ou via Docker:

```powershell
# MongoDB
docker run -d -p 27017:27017 --name mongodb `
  -e MONGO_INITDB_ROOT_USERNAME=admin `
  -e MONGO_INITDB_ROOT_PASSWORD=senha123 `
  mongo:8

# Redis
docker run -d -p 6379:6379 --name redis `
  redis:7-alpine redis-server --requirepass senha123
```

### 4. Popular banco

```powershell
npm run seed
```

### 5. Rodar em desenvolvimento

```powershell
npm run dev
```

Backend estará em: `http://localhost:3001`

## Variáveis de Ambiente

| Variável | Obrigatório | Descrição | Exemplo |
|----------|-------------|-----------|---------|
| `NODE_ENV` | Sim | Ambiente de execução | `development`, `production` |
| `PORT` | Sim | Porta do servidor | `3001` |
| `MONGODB_URI` | Sim | String de conexão MongoDB | `mongodb://admin:senha@localhost:27017/mini-saas?authSource=admin` |
| `REDIS_URL` | Sim | String de conexão Redis | `redis://:senha@localhost:6379` |
| `CORS_ORIGIN` | Sim | Origem permitida (frontend) | `http://localhost:3000` |
| `LOG_LEVEL` | Sim | Nível de log | `info`, `debug`, `error` |
| `JWT_SECRET` | Sim | Segredo para assinar JWT | Mínimo 32 caracteres |
| `JWT_EXPIRES_IN` | Sim | Tempo de expiração do token | `1h`, `7d` |
| `BCRYPT_SALT_ROUNDS` | Sim | Custo do hash de senha | `10` |
| `OPENAI_API_KEY` | Sim | Chave da API OpenAI | `sk-proj-...` |
| `OPENAI_MODEL` | Não | Modelo OpenAI | `gpt-4o-mini` (padrão) |
| `FRONTEND_URL` | Sim* | URL do frontend para emails | `http://localhost:3000` |
| `SMTP_HOST` | Sim* | Servidor SMTP | `smtp.gmail.com` |
| `SMTP_PORT` | Não | Porta SMTP | `587` (padrão) |
| `SMTP_SECURE` | Não | Usar SSL/TLS | `false` (padrão) |
| `SMTP_USER` | Não | Usuário SMTP | `seu-email@gmail.com` |
| `SMTP_PASS` | Não | Senha SMTP | `sua-senha-app` |
| `SMTP_FROM` | Sim* | Email remetente | `no-reply@example.com` |

\* Obrigatório apenas se quiser testar password reset e verificação de email

## Credenciais de Teste (após seed)

| Empresa | Role | Email | Senha |
|---------|------|-------|-------|
| TechCorp | Admin | `admin@techcorp.com` | `Admin123!` |
| TechCorp | User | `user@techcorp.com` | `User123!` |
| RetailCo | Admin | `admin@retailco.com` | `Admin123!` |
| RetailCo | User | `user@retailco.com` | `User123!` |

## Scripts Disponíveis

```powershell
# Desenvolvimento (hot reload)
npm run dev

# Build para produção
npm run build

# Rodar produção (após build)
npm start

# Popular banco de dados
npm run seed

# Testes
npm test                  # Todos os testes com coverage
npm run test:unit         # Apenas unit tests
npm run test:integration  # Apenas integration tests
npm run test:e2e          # Apenas e2e tests

# Qualidade de código
npm run lint              # ESLint
npm run type-check        # TypeScript check
```

## Estrutura de Pastas

```
backend/
├── src/
│   ├── config/           # Configurações (logger, redis, env)
│   ├── middleware/       # Middlewares (auth, rate limit, error handler)
│   ├── models/           # Models Mongoose (User, Company, Product, Chat)
│   ├── routes/           # Rotas Express
│   ├── services/         # Lógica de negócio
│   │   ├── llm/          # Integração OpenAI
│   │   ├── emailService.ts
│   │   ├── authService.ts
│   │   └── ...
│   ├── types/            # Tipos TypeScript
│   ├── utils/            # Utilitários
│   ├── app.ts            # Configuração Express
│   └── index.ts          # Entry point
├── tests/
│   ├── unit/             # Testes unitários
│   ├── integration/      # Testes de integração
│   └── e2e/              # Testes end-to-end
├── uploads/              # Imagens de produtos (gitignored)
├── scripts/
│   └── seed.js           # Script de seed
├── Dockerfile            # Multi-stage build
├── docker-compose.yml    # MongoDB + Redis + Backend
├── tsconfig.json         # Config TypeScript
└── package.json
```

## API Endpoints

### Autenticação
- `POST /api/auth/register` - Criar conta
- `POST /api/auth/login` - Login
- `POST /api/auth/forgot-password` - Solicitar reset de senha
- `POST /api/auth/reset-password` - Resetar senha com token
- `GET /api/auth/verify-email?token=...` - Verificar email
- `POST /api/auth/resend-verification` - Reenviar email de verificação

### Produtos (requer autenticação)
- `GET /api/products` - Listar produtos do tenant
- `GET /api/products/:id` - Buscar produto por ID
- `POST /api/products` - Criar produto (admin only)
- `PUT /api/products/:id` - Atualizar produto (admin only)
- `DELETE /api/products/:id` - Deletar produto (admin only)

### Upload (requer autenticação + admin)
- `POST /api/uploads/product-image` - Upload de imagem
- `GET /api/uploads/products/:companyId/:filename` - Servir imagem

### Chat (requer autenticação)
- `POST /api/chat` - Enviar mensagem (resposta completa)
- `POST /api/chat/stream` - Enviar mensagem (streaming SSE)
- `GET /api/chat/conversations` - Listar conversas
- `GET /api/chat/conversations/:id` - Buscar conversa por ID

### Health
- `GET /health` - Status do servidor, MongoDB e Redis

## Testes

```powershell
# Rodar todos os testes
npm test

# Rodar com watch mode
npm test -- --watch

# Rodar apenas um arquivo
npm test -- src/services/authService.test.ts

# Ver coverage
npm test -- --coverage
```

**Cobertura atual**: 97% statements · 85% branches · 95% funções · 52 suites · 263 testes

## Troubleshooting

### MongoDB não conecta
- Verifique se MongoDB está rodando: `docker ps`
- Teste conexão: `mongosh "mongodb://admin:senha@localhost:27017"`
- Verifique `MONGODB_URI` no `.env`

### Redis não conecta
- Verifique se Redis está rodando: `docker ps`
- Teste conexão: `redis-cli -a senha ping`
- Verifique `REDIS_URL` no `.env`

### OpenAI retorna erro 401
- Verifique se `OPENAI_API_KEY` está correta
- Confirme que tem créditos na conta OpenAI

### Rate limit muito restritivo
- Ajuste variáveis `RATE_LIMIT_*` no `.env`
- Ou faça login como admin (bypass automático)

### Email não envia
- Verifique configurações `SMTP_*`
- Para Gmail, use senha de app (não a senha normal)
- Teste SMTP: `npm run test:integration -- email`

## Logs

Logs são em formato JSON estruturado:

```json
{
  "level": "info",
  "time": 1234567890,
  "requestId": "abc-123",
  "msg": "Request completed",
  "req": { "method": "GET", "url": "/api/products" },
  "res": { "statusCode": 200 },
  "duration": 45
}
```

Ver logs em tempo real:

```powershell
# Docker
docker compose logs -f backend

# Manual
npm run dev
```

## Segurança

- Senhas hasheadas com bcrypt (10 rounds)
- JWT com expiração configurável
- Rate limiting em todos os endpoints críticos
- CORS configurado
- Dados sensíveis redatados dos logs
- Validação de input com Zod
- Isolamento multi-tenant rigoroso

## Licença

MIT

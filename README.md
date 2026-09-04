# Tex Estoque V1 — Cozinha de Montagem

Sistema criado a partir da planilha **Cozinha_Estoque_Minimos_V1.xlsx**.

## O que já funciona
- 72 itens cadastrados com o estoque mínimo semanal da planilha.
- Estoque alvo inicial = 150% do mínimo.
- Dashboard de itens OK / baixos / críticos.
- Entrada de estoque.
- Perda e ajuste de inventário.
- Histórico de movimentações.
- Lista automática de Produção e Compras.
- Fichas técnicas carregadas no `data.js`.
- Tela de sincronização Saipos.
- Funciona em modo local imediatamente.

## Firebase (para vários celulares/notebooks verem o mesmo estoque)
1. Abra `firebase-config.js`.
2. Cole o `firebaseConfig` do seu projeto Firebase.
3. No Firestore, publique as regras de `firestore.rules` para teste.
4. Para produção, recomendamos autenticação e regras restritas.

Sem Firebase, cada navegador mantém seu próprio estoque via localStorage.

## Saipos
Na Vercel, adicione:
- `SAIPOS_API_TOKEN` = seu token
- `SAIPOS_AUTH_MODE` = `raw` (padrão) ou `bearer`

A rota `/api/saipos?date=AAAA-MM-DD` tenta consultar `/sales_items` e normalizar o retorno.

### Segurança da V1
A sincronização começa manualmente para evitar baixa duplicada enquanto validamos o formato real da sua conta Saipos.
Depois de validar uma data real, podemos ativar um cron diário automático.

## Fichas incompletas
A planilha tem alguns pratos/ingredientes sem gramagem (especialmente pizzas e tábuas). A V1 não inventa essas quantidades:
- baixa somente ingredientes com quantidade informada;
- mostra aviso na tela Saipos sobre fichas incompletas.

## Deploy
O projeto não precisa de build:
1. Suba todos os arquivos para um repositório GitHub.
2. Importe o repositório na Vercel.
3. Configure as variáveis Saipos.
4. Faça o deploy.

## Estrutura
- `index.html` — interface
- `styles.css` — visual responsivo
- `app.js` — estoque, movimentos, alertas e sincronização
- `data.js` — cadastro, mínimos e fichas técnicas
- `firebase-config.js` — conexão Firestore
- `api/saipos.js` — proxy seguro para a Saipos
- `firestore.rules` — regras iniciais de teste

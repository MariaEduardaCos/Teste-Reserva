# Cancelamento de reserva via Telegram (Cloudflare Worker)

**Status:** implementação pronta para implantação em nuvem. Não é ativada só ao fazer merge. Sem Cloudflare Worker implantado e sem webhook registrado, os botões não funcionam.

O GitHub Actions mantém a reserva automática. O Cloudflare Worker recebe apenas comandos no Telegram, não executa reservas nem depende de computador ligado.

## Funcionalidades
- Botão **❌ Solicitar cancelamento** na nova mensagem de reserva.
- Comando privado **/cancelar MU-XXXXXXXX** para reservas anteriores.
- **Duas etapas**: solicitação e confirmação "✅ Sim, cancelar reserva".
- A confirmação expira em 5 minutos.
- Verifica se a mensagem e o remetente correspondem ao seu `TELEGRAM_CHAT_ID`.
- Somente considera cancelado quando o RPC `cancelar_minha_reserva_por_codigo` responder `sucesso: true`.
- Envia mensagem clara se a operação não for confirmada.
- Não usa `service_role`, e sim chave publishable/anon (a mesma usada no site).

## 1. Criar o Cloudflare Worker
1. Entre em https://dash.cloudflare.com/ e crie uma conta se necessário.
2. Vá em **Workers & Pages** > **Create** > **Worker** e crie um Worker chamado, por exemplo, `cancelamento-reserva-telegram`.
3. Abra o editor de código do Worker e substitua o conteúdo pelo arquivo `telegram-worker/src/index.js` desta branch.
4. Publique o Worker e copie sua URL HTTPS `https://...workers.dev`.
5. No painel do Worker, abra **Settings** > **Variables and Secrets** (o nome da tela pode variar) e adicione os cinco itens abaixo como **Secret**. Salve e implante as alterações.

| Secret do Cloudflare Worker | Valor |
|---|---|
| `TELEGRAM_BOT_TOKEN` | O mesmo token que você já salvou no GitHub |
| `TELEGRAM_CHAT_ID` | O mesmo Chat ID pessoal configurado no GitHub |
| `TELEGRAM_WEBHOOK_SECRET` | Novo segredo aleatório (caracteres A-Z, a-z, 0-9, `_` ou `-`; até 256) |
| `SUPABASE_URL` | URL pública do projeto Supabase (a mesma de `config.js`) |
| `SUPABASE_PUBLISHABLE_KEY` | Chave **publishable/anon** do Supabase (a mesma do `config.js`); **nunca** service_role |

IMPORTANTE: não cole tokens nem senhas em arquivos GitHub, no chat, em prints ou nos campos de URL do navegador.

## 2. Configurar GitHub para ativar o webhook
Na página **Settings > Secrets and variables > Actions** do repositório:

1. Em **Repository secrets**, crie `TELEGRAM_WEBHOOK_SECRET` com **o mesmo valor** que colocou no Worker.
2. Em **Variables** (não Secrets), crie `TELEGRAM_WORKER_URL` com a URL HTTPS pública do seu Worker (sem barra final).
3. Faça merge da branch após revisar os testes.
4. Em **Actions > Configurar Webhook Telegram (sem reservas)** clique **Run workflow**, branch `main`.
5. O workflow chama `setWebhook` no Telegram com `secret_token`, sem imprimir o token.

Não execute a ativação antes de publicar o Worker. Ativar o webhook substitui eventual webhook existente desse mesmo bot.

## 3. Como testar sem cancelar uma reserva
Depois que o Worker estiver publicado e o webhook ativado:
1. No seu Telegram, mande `/start` para seu bot. Ele deverá explicar o comando `/cancelar`.
2. Envie `/cancelar` **sem código**. Ele deverá explicar o formato correto.
3. Envie `/cancelar INVALIDO`. Ele deverá recusar o código.
4. Em uma mensagem de confirmação de reserva, pressione **Solicitar cancelamento** e depois **Não, manter reserva**. Isso não chama o Supabase.
5. Apenas se você tiver uma **reserva de teste própria e descartável**, confirme **Sim, cancelar reserva**; verifique no site se a reserva desapareceu.

**Atenção:** clicar em **Sim, cancelar reserva** com um código válido pode cancelar sua reserva real imediatamente. Não teste em reservas necessárias para a viagem.

## 4. Segurança e limitações
- O Worker aceita requisições webhook apenas com o header secreto definido em `TELEGRAM_WEBHOOK_SECRET`.
- Mensagens de chats ou usuários diferentes do Chat ID autorizado são ignoradas.
- A confirmação tem validade de 5 minutos, mas não cria uma prova persistente de uso único; o sistema Supabase é a fonte da verdade e recusa reservas já canceladas.
- Quem tiver acesso à sua conta do Telegram ou ao código da reserva poderá interagir com o mecanismo autorizado.
- Se o Supabase devolver uma falha, o bot **não afirma** que a reserva foi cancelada.
- O script não altera o bot de reservas já programado no GitHub Actions. O webhook recebe as mensagens continuamente na nuvem.
- O teste isolado `teste_telegram.yml` continua válido para verificar o envio.
- A chave publishable/anon só deve permitir as operações publicamente habilitadas no banco; caso RPC bloqueie o uso, será necessário rever as permissões no projeto Supabase, **sem usar chave service_role**.

## 5. Links
- Cloudflare dashboard: https://dash.cloudflare.com/
- Documentação dos secrets: https://developers.cloudflare.com/workers/configuration/secrets/
- Telegram Bot API: https://core.telegram.org/bots/api#setwebhook

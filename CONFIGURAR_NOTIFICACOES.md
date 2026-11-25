# Notificacoes e comprovantes (GitHub Actions)

O robô roda nos servidores do GitHub Actions: **nenhum notebook precisa ficar ligado**.
Apenas a conexão aos serviços da internet/GitHub/Supabase precisa estar disponível.

## 1. Configurar Secrets
No repositório, abra **Settings > Secrets and variables > Actions > New repository secret**.
Cadastre os itens abaixo, sem colar valores nos arquivos do repositório:

| Secret | Para que serve |
| --- | --- |
| `SMTP_USER` | Conta de e-mail remetente (ex.: Gmail) |
| `SMTP_PASSWORD` | Senha de aplicativo Gmail (não use a senha normal da conta) |
| `EMAIL_DESTINO` | E-mail que receberá o comprovante |
| `TELEGRAM_BOT_TOKEN` | Token obtido no BotFather |
| `TELEGRAM_CHAT_ID` | Identificador do chat privado que receberá as mensagens |
| `COMPROVANTE_SENHA` | Senha forte para criptografar o comprovante guardado no GitHub |

Para Gmail, a conta precisa permitir uma senha de aplicativo. Em geral é necessário ativar a
verificação em duas etapas. O envio usa `smtp.gmail.com`, porta 465. Se utilizar outro
provedor SMTP, altere `SMTP_HOST` e `SMTP_PORT` na configuração do ambiente do workflow.

Para Telegram, abra uma conversa com o seu bot e mande `/start`; sem isso ele pode não
conseguir enviar mensagens. O token é secreto. Identifique o chat ID pela API do Telegram
ou por um bot confiável, sem compartilhar o token publicamente.

## 2. Funcionamento
Quando o sistema confirmar uma nova reserva, o script:
1. Salva um comprovante JSON e TXT temporários no runner.
2. Tenta enviar um e-mail (caso Secrets de e-mail existam).
3. Tenta enviar uma mensagem Telegram (caso Secrets Telegram existam).
4. Criptografa o comprovante JSON com GPG/AES-256 usando `COMPROVANTE_SENHA`.
5. Publica **somente a cópia criptografada** como artefato do workflow.

Se e-mail ou Telegram falharem, a reserva não é cancelada, e o outro canal continua sendo
tentado. Se a reserva já existir, é gerado um comprovante, mas as mensagens não são enviadas
novamente. Se não houver senha de criptografia, o arquivo **não é publicado** no GitHub.

Nenhuma configuração de notificação é necessária para o funcionamento básico do robô.

## 3. Como consultar o comprovante
- Abra **Actions > Reserva Universitária Automática > execução desejada**.
- Em **Artifacts**, baixe `comprovante-reserva-<run-id>`.
- Descompacte o ZIP e abra o `.gpg` com um programa compatível com GPG.
- Para descriptografar no terminal (com GPG instalado):
  `gpg --output comprovante.json --decrypt comprovante.json.gpg`
- Informe a senha cadastrada em `COMPROVANTE_SENHA`.

Os artefatos permanecem por até **30 dias**, sujeitos à retenção/configuração e à
disponibilidade do GitHub. E-mail e Telegram são os canais mais práticos para consulta diária.

**Importante:** O repositório é público. Não coloque a senha de criptografia, tokens,
identificadores ou o código de reserva em arquivos commitados, Issues ou logs. Alterar o
repositório para privado oferece proteção adicional.

## 4. Testes
Faça um teste de notificações separadamente, com credenciais configuradas, antes de
depender do sistema. Uma execução manual de reserva real pode realizar uma reserva
de verdade; não use `--forcar` para teste sem essa intenção.

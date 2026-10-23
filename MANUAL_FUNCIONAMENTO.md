# 📘 Guia de Funcionamento da Automação de Reserva

Este documento detalha o funcionamento completo do robô de reserva de poltronas para o transporte universitário de Maurilândia (UniRV - Engenharia de Software).

---

## ⏰ 1. Horários de Execução Automática

A automação foi programada com a regra de segurança **"sniper"**: ela acorda **2 minutos antes** da abertura oficial da lista para testar a conexão e já começar os disparos de 2 em 2 segundos. No segundo exato em que a prefeitura abre o sistema, ela reserva imediatamente antes dos outros alunos.

| Dia da Semana | Horário dos Disparos | Abertura Oficial da Lista | Viagem Referente | Status |
| :--- | :---: | :---: | :---: | :---: |
| **Domingo** | **17:58h** | 18:00h | Segunda-feira | ✅ Ativo |
| **Segunda-feira** | **21:58h** | 22:00h | Terça-feira | ✅ Ativo |
| **Terça-feira** | **21:58h** | 22:00h | Quarta-feira | ✅ Ativo |
| **Quarta-feira** | **21:58h** | 22:00h | Quinta-feira | ✅ Ativo |
| **Quinta-feira** | **21:58h** | 22:00h | Sexta-feira | ✅ Ativo |
| **Sexta-feira** | — | — | Sábado (Não tem aula) | 🛑 **Bloqueado** |
| **Sábado** | — | — | Domingo (Não tem aula) | 🛑 **Bloqueado** |

> [!NOTE]
> Nas noites de **sexta-feira** e aos **sábados**, a automação desliga propositalmente para não gastar cotas ou fazer reservas desnecessárias.

---

## ☁️ 2. Onde Ela Roda Automaticamente?

Você possui **duas proteções independentes** configuradas:

1. **Na Nuvem (GitHub Actions)**:
   - Roda sem precisar do computador ou celular ligados.
   - O GitHub liga a máquina com antecedência (21:35h e 21:50h de seg-qui / 17:35h e 17:50h de domingo) para evitar filas de servidores.
   - Ela aguarda calmamente até 21:58:00h (ou 17:58:00h no domingo) e inicia as tentativas de 2 em 2 segundos.
2. **No seu Computador (Agendador Cron)**:
   - Se o seu computador estiver ligado às 21:58h (ou 17:58h no domingo), o agendador local também executa como contingência.

---

## 🪑 3. Prioridade de Escolha de Poltrona

O robô analisa em tempo real o mapa do ônibus e escolhe a poltrona seguindo exatamente a sua preferência:

1. **1ª Prioridade (Janela / Fundo a Meio)**: Poltronas ímpares da fileira da janela a partir da poltrona 9:
   - `9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29`
2. **2ª Prioridade (Corredor / Qualquer par)**:
   - `2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28`
3. **3ª Prioridade (Frente do ônibus)**:
   - `1, 3, 5, 7`

---

## 🚌 4. Seleção e Troca de Ônibus

Os ônibus cadastrados no sistema são:
- **Ônibus 1**: Prefixo `0542` (Motorista: Dheimes)
- **Ônibus 2**: Prefixo `0519` (Motorista: Adalberto)
- **Ônibus 3**: Prefixo `0507` (Motorista: Edson)

### Como escolher qual ônibus ela vai reservar?

Você tem 3 maneiras fáceis:

### A) Direto pelo GitHub Actions (Celular ou Computador)
1. Abra o repositório no GitHub: [github.com/MariaEduardaCos/Teste-Reserva](https://github.com/MariaEduardaCos/Teste-Reserva)
2. Vá em **Actions** $\rightarrow$ **Reserva Universitária Automática**.
3. Clique em **Run workflow** (no lado direito).
4. No campo **"Número do ônibus"**, digite `1`, `2` ou `3` e clique no botão verde.
   *(Você pode fazer isso a partir das 20:50h! O robô confirma a sua escolha e aguarda o horário exato da abertura).*

### B) Deixar o Ônibus Pré-Definido no Arquivo (`config_onibus.json`)
No arquivo `config_onibus.json` você pode deixar programado de forma fixa:
- `"onibus_padrao": 2` $\rightarrow$ Ônibus de segunda a quinta.
- `"onibus_viagem_sexta": 1` $\rightarrow$ Ônibus automático para a viagem de sexta-feira.

### C) Por Comando Rápido no Terminal do Computador
- Para definir o ônibus de hoje sem precisar esperar:
  ```bash
  python3 bot_teste_local.py --mudar-proxima 1
  ```
- Para abrir o menu interativo:
  ```bash
  python3 bot_teste_local.py --menu
  ```
- Para iniciar com antecedência (ex: 20:50h) já travado no ônibus desejado:
  ```bash
  python3 bot_teste_local.py --onibus 1
  ```

---

## 📝 Resumo Rápido

- **Você não precisa fazer nada:** Se não trocar nada, ele vai rodar sozinho no horário programado e reservar o ônibus padrão.
- **Se quiser trocar o ônibus:** Pode digitar o número no GitHub Actions às 20:50h ou usar o comando no computador.
- **Sexta e Sábado:** O robô não roda, preservando seu descanso e seus dados.

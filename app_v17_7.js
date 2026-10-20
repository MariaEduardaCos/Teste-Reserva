
// ============================================================
// RESERVA TRANSPORTE UNIVERSITÁRIO - MAURILÂNDIA/GO
// ============================================================

let supabaseClient = null;

if (!window.__reservaUniversitariaInicializada) {

  window.__reservaUniversitariaInicializada = true;

  // ==========================================================
  // ÔNIBUS
  // ==========================================================

  const buses = {
    1: {
      numero: "0542",
      motorista: "Dheimes"
    },
    2: {
      numero: "0519",
      motorista: "Adalberto"
    },
    3: {
      numero: "0507",
      motorista: "Edson"
    }
  };

  // ==========================================================
  // VARIÁVEIS
  // ==========================================================

  let selectedBus = null;
  let selectedSeat = null;
  let currentDate = null;

  // V15: a VAN possui 17 vagas.
  const VAN_CAPACIDADE = 17;

  // Protege contra chamadas simultâneas
  let renderBusesVersion = 0;

  // ==========================================================
  // ELEMENTOS
  // ==========================================================

  const dateInput =
    document.querySelector("#date");

  const dateCalendar =
    document.querySelector("#date-calendar");

  const openCalendarButton =
    document.querySelector("#open-calendar");

  const busList =
    document.querySelector("#bus-list");

  const seatSection =
    document.querySelector("#seat-section");

  const seatMap =
    document.querySelector("#seat-map");

  const selectedSeatLabel =
    document.querySelector("#selected-seat");

  const studentSection =
    document.querySelector("#student-section");

  const nameInput =
    document.querySelector("#name");

  const nameSuggestions =
    document.querySelector("#universitarios-sugestoes");

  let ultimaBuscaNomes = "";
  let timerBuscaNomes = null;

  const courseInput =
    document.querySelector("#course");

  const institutionInput =
    document.querySelector("#institution");

  const confirmButton =
    document.querySelector("#confirm");

  const message =
    document.querySelector("#message");

  // ==========================================================
  // CONSULTA / CANCELAMENTO
  // ==========================================================

  let lookupNameInput = null;
  let lookupCodeInput = null;
  let lookupButton = null;
  let lookupNameOnlyInput = null;
  let lookupDateInput = null;
  let lookupNameButton = null;
  let lookupResult = null;
  let reservaConsultaAtual = null;


  // ==========================================================
  // SUPABASE
  // ==========================================================

  function iniciarSupabase() {

    if (typeof supabase === "undefined") {

      console.error(
        "Biblioteca do Supabase não carregada."
      );

      return false;
    }

    if (
      typeof SUPABASE_URL === "undefined" ||
      typeof SUPABASE_PUBLISHABLE_KEY === "undefined"
    ) {

      console.error(
        "Configuração do Supabase não encontrada."
      );

      return false;
    }

    supabaseClient =
      supabase.createClient(
        SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY
      );

    console.log(
      "Supabase conectado ao projeto."
    );

    return true;
  }



  // ==========================================================
  // INSTITUIÇÕES DE ENSINO
  // ==========================================================

  const instituicoesPadrao = [
    "UNIRV",
    "UNIRV CENTRO",
    "UNIBRAS",
    "FAR",
    "TECMAIS",
    "SESI/SENAI",
    "UNOPAR",
    "QUALITY",
    "ÁTOMO",
    "UEG - SHEGO",
    "CETEG - SHEGO",
    "UNIASSELVI",
    "UNICESUMAR"
  ];

  let instituicoesEnsino = [...instituicoesPadrao];

  async function carregarInstituicoesEnsino() {
    const select = document.querySelector("#institution");

    // Mantém a lista atual como segurança caso o banco ainda não
    // tenha a nova função configurada.
    if (!select) return;

    try {
      if (!supabaseClient) return;

      const { data, error } = await supabaseClient.rpc(
        "listar_instituicoes_ativas"
      );

      if (!error && Array.isArray(data) && data.length) {
        instituicoesEnsino = data
          .map(item => String(item.nome || "").trim())
          .filter(Boolean);
      }
    } catch (e) {
      console.warn("Não foi possível carregar instituições do banco. Usando lista padrão.", e);
    }

    const atual = select.value;

    select.innerHTML = '<option value="">Selecione sua instituição</option>';

    instituicoesEnsino.forEach(nome => {
      const option = document.createElement("option");
      option.value = nome;
      option.textContent = nome;
      select.appendChild(option);
    });

    if (atual && instituicoesEnsino.some(
      nome => nome.toLowerCase() === atual.toLowerCase()
    )) {
      select.value = atual;
    }
  }

  function instituicaoValida(valor) {
    const normalizado = String(valor || "").trim().toLowerCase();
    return instituicoesEnsino.some(
      nome => nome.toLowerCase() === normalizado
    );
  }

  // ==========================================================
  // MENSAGEM
  // ==========================================================

  function mostrarMensagem(
    texto,
    tipo = ""
  ) {

    if (!message) {
      return;
    }

    message.innerHTML = texto;

    message.className = "message";

    if (tipo) {
      message.classList.add(tipo);
    }
  }


  // ==========================================================
  // JANELA DE RESERVAS - 15H / 22H
  // ==========================================================

  function obterDataLocal(offsetDias = 0) {
    const agora = new Date();
    agora.setDate(agora.getDate() + offsetDias);
    return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}-${String(agora.getDate()).padStart(2, "0")}`;
  }

  function horaAtualEmMinutos() {
    const agora = new Date();
    return agora.getHours() * 60 + agora.getMinutes();
  }

  function diaDaSemanaLocal(offsetDias = 0) {
    const agora = new Date();
    agora.setDate(agora.getDate() + offsetDias);
    return agora.getDay();
  }

  function ehDiaDeViagem(data) {
    if (!data) return false;
    const d = new Date(`${data}T12:00:00`);
    const dia = d.getDay();
    return dia >= 1 && dia <= 5;
  }

  function obterProximaDataViagemAtual() {
    if (window.__configTesteLocal && window.__configTesteLocal.ativo && window.__configTesteLocal.data_alvo) {
      return window.__configTesteLocal.data_alvo;
    }

    const dia = diaDaSemanaLocal(0);
    const hora = horaAtualEmMinutos();

    // Segunda a quinta: depois das 22h, abre o dia útil seguinte.
    if (dia >= 1 && dia <= 4 && hora >= 22 * 60) {
      return obterDataLocal(1);
    }

    // Sexta: não existe abertura para sábado.
    if (dia === 5) {
      return obterDataLocal(0);
    }

    // Sábado: não há viagem; o próximo dia de viagem é segunda.
    if (dia === 6) {
      return obterDataLocal(2);
    }

    // Domingo: a lista de segunda é a próxima viagem.
    if (dia === 0) {
      return obterDataLocal(1);
    }

    return obterDataLocal(0);
  }

  function reservaPodeSerFeita(data) {
    if (!data || !ehDiaDeViagem(data)) return false;

    if (window.__configTesteLocal && window.__configTesteLocal.ativo) {
      return Boolean(window.__configTesteLocal.aberta_agora);
    }

    const hora = horaAtualEmMinutos();
    const dia = diaDaSemanaLocal(0);
    const hoje = obterDataLocal(0);
    const amanha = obterDataLocal(1);

    // Domingo: abertura especial às 18h para segunda-feira.
    if (dia === 0) {
      return hora >= 18 * 60 && data === amanha;
    }

    // Sábado: não há reservas nem viagens.
    if (dia === 6) {
      return false;
    }

    // Segunda a sexta.
    if (hora < 15 * 60) {
      return data === hoje;
    }

    if (hora < 22 * 60) {
      return false;
    }

    // Sexta-feira não abre para sábado.
    if (dia === 5) {
      return false;
    }

    return data === amanha && ehDiaDeViagem(amanha);
  }

  function mensagemJanelaReserva(data) {
    if (window.__configTesteLocal && window.__configTesteLocal.ativo) {
      if (!window.__configTesteLocal.aberta_agora) {
        return `
          <strong>🔒 [MODO DE TESTE] Novas reservas encerradas neste momento.</strong>
          <br><br>
          A lista de testes será liberada automaticamente às
          <strong>${window.__configTesteLocal.horario_abertura}</strong>
          (Horário atual: <strong>${window.__configTesteLocal.hora_servidor || ""}</strong>).
          <br><br>
          <small>🔄 Recarregando automaticamente a cada 2 segundos...</small>
        `;
      }
      return "";
    }

    const hora = horaAtualEmMinutos();
    const dia = diaDaSemanaLocal(0);
    const hoje = obterDataLocal(0);
    const amanha = obterDataLocal(1);

    if (dia === 0) {
      if (hora < 18 * 60) {
        return `
          <strong>🔒 Novas reservas ainda estão fechadas.</strong>
          <br><br>
          Aos domingos, a lista de segunda-feira será liberada às
          <strong>18h00</strong>.
          <br><br>
          <small>
            Não há viagens aos sábados e domingos.
          </small>
        `;
      }

      if (data !== amanha) {
        return `
          <strong>🔒 Esta data não está aberta para novas reservas.</strong>
          <br><br>
          Neste momento, as reservas estão abertas somente
          para <strong>segunda-feira</strong>.
        `;
      }

      return "";
    }

    if (dia === 6) {
      return `
        <strong>🔒 Novas reservas estão fechadas neste fim de semana.</strong>
        <br><br>
        A lista de segunda-feira será liberada no
        <strong>domingo às 18h00</strong>.
      `;
    }

    if (hora >= 15 * 60 && hora < 22 * 60) {
      const proxima = dia === 5
        ? 'domingo às 18h00'
        : '22h00';

      return `
        <strong>🔒 Novas reservas encerradas.</strong>
        <br><br>
        As novas reservas ficam encerradas das
        <strong>15h00 às 22h00</strong>.
        <br><br>
        ${dia === 5
          ? 'A lista de segunda-feira será liberada no <strong>domingo às 18h00</strong>.'
          : `A lista do próximo dia será liberada às <strong>${proxima}</strong>.`}
        <br><br>
        <small>
          Se você já possui uma reserva, ainda poderá
          consultá-la e cancelá-la.
        </small>
      `;
    }

    if (hora < 15 * 60 && data !== hoje) {
      return `
        <strong>🔒 Esta data não está aberta para novas reservas.</strong>
        <br><br>
        Neste momento, as reservas estão abertas somente
        para <strong>hoje</strong>.
        <br><br>
        ${dia === 5
          ? 'A lista de segunda-feira será liberada no <strong>domingo às 18h00</strong>.'
          : 'A lista de amanhã será liberada às <strong>22h00</strong>.'}
      `;
    }

    if (hora >= 22 * 60 && (dia === 5 || data !== amanha || !ehDiaDeViagem(amanha))) {
      return `
        <strong>🔒 Esta data não está aberta para novas reservas.</strong>
        <br><br>
        ${dia === 5
          ? 'Não há abertura para sábado. A lista de segunda-feira será liberada no <strong>domingo às 18h00</strong>.'
          : 'Neste momento, as reservas estão abertas somente para <strong>amanhã</strong>.'}
      `;
    }

    return "";
  }

  function mostrarAvisoEncerramento() {
    mostrarMensagem(
      mensagemJanelaReserva(currentDate) ||
      "<strong>🔒 Novas reservas não estão disponíveis neste momento.</strong>",
      "error"
    );
  }

  function atualizarLimitesData() {
    const hoje = obterDataLocal(0);
    const dataMaxima = obterProximaDataViagemAtual();

    if (dateCalendar) {
      dateCalendar.min = hoje;
      dateCalendar.max = dataMaxima;
    }
  }

  function formatarDataParaCampo(data) {
    if (!data) return "";
    const partes = data.split("-");
    if (partes.length !== 3) return data;
    return `${partes[2]}/${partes[1]}/${partes[0]}`;
  }

  function converterCampoParaData(valor) {
    const texto = String(valor || "").trim();
    if (!texto) return "";

    // Aceita DD/MM/AAAA e também DDMMYYYY.
    const limpo = texto.replace(/\D/g, "");
    if (limpo.length === 8) {
      const dia = limpo.slice(0, 2);
      const mes = limpo.slice(2, 4);
      const ano = limpo.slice(4, 8);
      const data = `${ano}-${mes}-${dia}`;
      if (ehDataValida(data)) return data;
    }

    // Também aceita AAAA-MM-DD caso o navegador forneça esse formato.
    if (/^\d{4}-\d{2}-\d{2}$/.test(texto) && ehDataValida(texto)) {
      return texto;
    }

    return null;
  }

  function ehDataValida(data) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return false;
    const [ano, mes, dia] = data.split("-").map(Number);
    const d = new Date(ano, mes - 1, dia);
    return d.getFullYear() === ano && d.getMonth() === mes - 1 && d.getDate() === dia;
  }

  function aplicarDataSelecionada(data) {
    currentDate = data || null;
    selectedBus = null;
    selectedSeat = null;

    if (seatSection) seatSection.style.display = "none";
    if (studentSection) studentSection.style.display = "none";
    if (confirmButton) confirmButton.disabled = true;

    if (dateInput) {
      dateInput.value = formatarDataParaCampo(currentDate);
    }
    if (dateCalendar) {
      dateCalendar.value = currentDate || "";
    }

    mostrarMensagem(
      currentDate && !reservaPodeSerFeita(currentDate)
        ? mensagemJanelaReserva(currentDate)
        : "",
      currentDate && !reservaPodeSerFeita(currentDate) ? "error" : ""
    );

    atualizarLimitesData();
    renderBuses();
  }


  // ==========================================================
  // CONSULTAR POLTRONAS OCUPADAS
  // ==========================================================

  async function buscarPoltronasOcupadas(
    onibus,
    data = currentDate
  ) {

    if (!supabaseClient) {

      return {
        ocupadas: [],
        erro: "Supabase não conectado."
      };
    }

    if (!data) {

      return {
        ocupadas: [],
        erro: null
      };
    }

    try {

      const {
        data: resultado,
        error
      } =
        await supabaseClient.rpc(
          "consultar_poltronas_ocupadas_detalhes",
          {
            p_data: data,
            p_onibus: Number(onibus)
          }
        );


      if (error) {

        console.error(
          `Erro ao consultar poltronas do ônibus ${onibus}:`,
          error
        );

        return {
          ocupadas: [],
          erro:
            error.message ||
            "Erro ao consultar disponibilidade."
        };
      }


      const lista = resultado || [];

      const nomesPorPoltrona = {};
      lista.forEach(item => {
        nomesPorPoltrona[Number(item.poltrona)] = item.nome || "";
      });

      return {
        ocupadas: lista.map(item => Number(item.poltrona)),
        nomesPorPoltrona,
        erro: null
      };


    } catch (error) {

      console.error(error);

      return {

        ocupadas: [],

        erro:
          error.message ||
          "Erro ao consultar disponibilidade."
      };
    }
  }


  // ==========================================================
  // MOSTRAR OS 3 ÔNIBUS
  // ==========================================================

  async function cotasUnirvEsgotadas() {
    try {
      const resultados = await Promise.all([1, 2, 3].map(async (onibus) => {
        const { data, error } = await supabaseClient.rpc("verificar_cota_unirv", { p_data: currentDate, p_onibus: onibus });
        if (error) throw error;
        return data;
      }));
      return resultados.length === 3 && resultados.every(cota => cota && cota.liberada === false);
    } catch (error) {
      console.error("Erro ao verificar as cotas UniRV:", error);
      return false;
    }
  }


  // ==========================================================
  // CONSULTAR VAGAS DA VAN
  // ==========================================================

  async function buscarVagasVanOcupadas(
    data = currentDate
  ) {

    if (!supabaseClient) {
      return {
        ocupadas: [],
        erro: "Supabase não conectado."
      };
    }

    if (!data) {
      return {
        ocupadas: [],
        erro: null
      };
    }

    try {

      const {
        data: resultado,
        error
      } = await supabaseClient.rpc(
        "consultar_vagas_van",
        {
          p_data: data
        }
      );

      if (error) {
        console.error("Erro ao consultar vagas da VAN:", error);

        return {
          ocupadas: [],
          erro: error.message || "Erro ao consultar vagas da VAN."
        };
      }

      const lista = Array.isArray(resultado)
        ? resultado
        : [];

      const ocupadas = lista
        .map(item => Number(item.poltrona))
        .filter(n => Number.isInteger(n) && n >= 1 && n <= VAN_CAPACIDADE);

      const nomesPorVaga = {};
      lista.forEach(item => {
        const vaga = Number(item.poltrona);
        if (Number.isInteger(vaga) && vaga >= 1 && vaga <= VAN_CAPACIDADE) {
          nomesPorVaga[vaga] = String(item.nome || '').trim();
        }
      });

      return {
        ocupadas,
        nomesPorVaga,
        erro: null
      };

    } catch (error) {

      console.error(error);

      return {
        ocupadas: [],
        erro: error.message || "Erro ao consultar vagas da VAN."
      };
    }
  }


  // ==========================================================
  // MOSTRAR VAGAS V1 A V17 DA VAN
  // ==========================================================

  async function renderVanSeats(
    somenteVisualizacao = false,
    motivoVisualizacao = "fechadas"
  ) {

    if (!seatMap) {
      console.error("Elemento #seat-map não encontrado.");
      return;
    }

    seatMap.innerHTML = "";

    if (selectedBus !== "VAN" || !currentDate) {
      return;
    }

    const resultado =
      await buscarVagasVanOcupadas(currentDate);

    if (resultado.erro) {

      seatMap.innerHTML = `
        <p>
          Não foi possível carregar as vagas da VAN.
        </p>
      `;

      console.error(resultado.erro);
      return;
    }

    const ocupadas = resultado.ocupadas || [];
    const nomesPorVaga = resultado.nomesPorVaga || {};

    for (let vaga = 1; vaga <= VAN_CAPACIDADE; vaga++) {

      const button = document.createElement("button");

      button.type = "button";
      button.className = "seat van-seat";

      const numero = `V${vaga}`;

      button.textContent = numero;

      if (ocupadas.includes(vaga)) {

        button.disabled = true;
        button.classList.add("occupied");

        const nomeReservante = nomesPorVaga[vaga] || "";
        const partesNome = nomeReservante.split(/\s+/).filter(Boolean);
        const nomeCurto = partesNome.length >= 2
          ? `${partesNome[0]} ${partesNome[1]}`
          : (partesNome[0] || "");

        button.title = nomeReservante
          ? `${numero} — ${nomeReservante}`
          : `${numero} já ocupada`;

        button.innerHTML = nomeCurto
          ? `<span class="seat-number">${numero}</span><span class="seat-reserved-name">${escapeHtml(nomeCurto)}</span>`
          : `<span class="seat-number">${numero}</span>`;

      } else if (somenteVisualizacao) {

        button.disabled = true;
        button.classList.add("locked-view");
        button.title = `${numero} disponível`;
        button.innerHTML = `<span class="seat-lock">🔒</span><span class="seat-number">${numero}</span>`;

      } else {

        button.classList.add("available");

        button.addEventListener(
          "click",
          function () {
            selecionarVagaVan(vaga);
          }
        );
      }

      seatMap.appendChild(button);
    }

    if (somenteVisualizacao && selectedSeatLabel) {
      selectedSeatLabel.textContent =
        motivoVisualizacao === "lotado"
          ? "🔒 VAN lotada. Visualização das vagas."
          : "🔒 Visualização: reservas fechadas neste horário.";
    }
  }


  // ==========================================================
  // SELECIONAR VAGA DA VAN
  // ==========================================================

  function selecionarVagaVan(vaga) {

    if (!reservaPodeSerFeita(currentDate)) {
      mostrarAvisoEncerramento();
      return;
    }

    selectedSeat = Number(vaga);

    if (seatMap) {

      seatMap
        .querySelectorAll(".seat")
        .forEach(seat => {
          seat.classList.remove("selected");
        });

      const botoes = seatMap.querySelectorAll(".seat");

      botoes.forEach(seat => {
        if (seat.textContent.trim() === `V${selectedSeat}`) {
          seat.classList.add("selected");
        }
      });
    }

    if (selectedSeatLabel) {
      selectedSeatLabel.textContent =
        `Vaga V${selectedSeat} da VAN selecionada.`;
    }

    if (studentSection) {
      studentSection.style.display = "block";
    }

    if (confirmButton) {
      confirmButton.disabled = false;
    }

    mostrarMensagem("");
  }


  async function renderVanSeLiberada(dataConsultada, minhaVersao) {
    if (!busList || dataConsultada !== currentDate || minhaVersao !== renderBusesVersion) return;

    // A VAN permanece visível enquanto houver qualquer reserva ativa nela,
    // mesmo que uma das cotas UniRV volte a ter vaga. Ela só desaparece
    // quando não há reservas na VAN e as cotas ainda não estão esgotadas.
    const { data: van, error } = await supabaseClient.rpc("verificar_vagas_van", { p_data: dataConsultada });
    if (error) {
      console.error("Erro ao verificar vagas da VAN:", error);
      return;
    }

    if (dataConsultada !== currentDate || minhaVersao !== renderBusesVersion) return;

    const utilizadas = Number(van?.utilizadas || 0);
    const limite = Number(van?.limite || VAN_CAPACIDADE);
    const restantes = Math.max(limite - utilizadas, 0);

    const cotasEsgotadas = await cotasUnirvEsgotadas();

    if (dataConsultada !== currentDate || minhaVersao !== renderBusesVersion) return;

    // Se não há reservas na VAN e as cotas ainda não acabaram, a VAN não aparece.
    // Se já existe ao menos uma reserva na VAN, ela continua aparecendo.
    if (utilizadas <= 0 && !cotasEsgotadas) return;

    const card = document.createElement("button");
    card.type = "button";
    card.className = "bus van-card";

    if (restantes > 0) {
      card.addEventListener("click", selecionarVan);
    } else {
      // Mesmo lotada, a VAN permanece clicável somente para visualização,
      // exatamente como os ônibus lotados.
      card.disabled = false;
      card.classList.add("full");
      card.addEventListener("click", function () {
        selecionarVan(true, "lotado");
      });
    }

    const avisoPersistencia = utilizadas > 0 && !cotasEsgotadas
      ? '<small>Há reservas ativas na VAN, por isso ela continua visível.</small>'
      : '<small>Disponível automaticamente quando as cotas UniRV dos 3 ônibus estiverem esgotadas.</small>';

    card.innerHTML = `<strong>🚐 VAN – EXCEDENTES</strong><span>${restantes} de ${limite} vagas disponíveis</span>${avisoPersistencia}${restantes <= 0 ? '<small>LOTADA</small><small class="lotado-visualizar">👆 Clique para visualizar as vagas</small>' : ''}`;
    busList.appendChild(card);
  }

  async function renderBuses() {

    if (!busList) {

      console.error(
        "Elemento #bus-list não encontrado."
      );

      return;
    }


    if (!currentDate) {

      busList.innerHTML = "";

      return;
    }


    // Identifica esta renderização
    const minhaVersao =
      ++renderBusesVersion;


    // Limpa antes de criar
    busList.innerHTML = "";


    const listaOnibus = [
      1,
      2,
      3
    ];


    for (
      const bus of listaOnibus
    ) {

      const dataConsultada =
        currentDate;


      const resultado =
        await buscarPoltronasOcupadas(
          bus,
          dataConsultada
        );


      // Outra atualização começou
      if (
        minhaVersao !== renderBusesVersion
      ) {
        return;
      }


      // A data mudou
      if (
        dataConsultada !== currentDate
      ) {
        return;
      }


      const card =
        document.createElement("button");


      card.type = "button";

      card.className = "bus";


      // ======================================================
      // ERRO
      // ======================================================

      if (resultado.erro) {

        card.disabled = true;

        card.innerHTML = `
          <strong>
            Ônibus ${buses[bus].numero}
          </strong>

          <span>
            Motorista:
            ${buses[bus].motorista}
          </span>

          <small>
            Erro ao carregar disponibilidade
          </small>
        `;

        busList.appendChild(card);

        continue;
      }


      // ======================================================
      // DISPONIBILIDADE
      // ======================================================

      const capacidade = 48;

      const ocupadas =
        resultado.ocupadas;

      const disponiveis =
        Math.max(
          0,
          capacidade - ocupadas.length
        );


      card.innerHTML = `
        <strong>
          Ônibus ${buses[bus].numero}
        </strong>

        <span>
          Motorista:
          ${buses[bus].motorista}
        </span>

        <small>
          ${disponiveis}
          de
          ${capacidade}
          poltronas disponíveis
        </small>
      `;


      // ======================================================
      // HORÁRIO FECHADO
      // ======================================================

      if (!reservaPodeSerFeita(currentDate)) {

        // Mantém o ônibus clicável apenas para visualização.
        card.classList.add("locked");

        card.innerHTML = `
          <strong>
            Ônibus ${buses[bus].numero}
          </strong>

          <span>
            Motorista:
            ${buses[bus].motorista}
          </span>

          <small>
            ${disponiveis} de ${capacidade} poltronas disponíveis
          </small>

          <small>
            🔒 Reservas fechadas neste horário
          </small>
        `;

        card.addEventListener(
          "click",
          function () {
            selecionarOnibus(bus, true, "fechadas");
          }
        );

      }

      // ======================================================
      // LOTADO
      // ======================================================

      else if (disponiveis === 0) {

        // Mesmo lotado, permite abrir o mapa somente para visualização,
        // para que seja possível conferir todas as poltronas e nomes.
        card.disabled = false;
        card.classList.add("full");

        card.innerHTML = `
          <strong>
            Ônibus ${buses[bus].numero}
          </strong>

          <span>
            Motorista:
            ${buses[bus].motorista}
          </span>

          <small>
            LOTADO
          </small>

          <small class="lotado-visualizar">
            👆 Clique para visualizar as poltronas
          </small>
        `;

        card.addEventListener(
          "click",
          function () {
            selecionarOnibus(bus, true, "lotado");
          }
        );

      }


      // ======================================================
      // DISPONÍVEL
      // ======================================================

      else {

        card.addEventListener(
          "click",
          function () {

            selecionarOnibus(bus);

          }
        );
      }


      // Última proteção
      if (
        minhaVersao !== renderBusesVersion
      ) {
        return;
      }


      busList.appendChild(card);
    }

    await renderVanSeLiberada(currentDate, minhaVersao);
  }


  // ==========================================================
  // SELECIONAR ÔNIBUS
  // ==========================================================

  async function selecionarVan(
    somenteVisualizacao = false,
    motivoVisualizacao = "fechadas"
  ) {

    if (
      !somenteVisualizacao &&
      !reservaPodeSerFeita(currentDate)
    ) {
      mostrarAvisoEncerramento();
      return;
    }

    selectedBus = "VAN";
    selectedSeat = null;

    if (selectedSeatLabel) {
      selectedSeatLabel.textContent =
        "Nenhuma vaga da VAN selecionada.";
    }

    if (studentSection) {
      studentSection.style.display = "none";
    }

    if (confirmButton) {
      confirmButton.disabled = true;
    }

    if (seatSection) {
      seatSection.style.display = "block";
    }

    await renderVanSeats(somenteVisualizacao, motivoVisualizacao);
    mostrarMensagem("");
  }

  async function selecionarOnibus(
    onibus,
    somenteVisualizacao = false,
    motivoVisualizacao = "fechadas"
  ) {

    if (
      !somenteVisualizacao &&
      !reservaPodeSerFeita(currentDate)
    ) {
      mostrarAvisoEncerramento();
      return;
    }

    selectedBus =
      Number(onibus);

    selectedSeat = null;


    if (selectedSeatLabel) {

      selectedSeatLabel.textContent =
        "Nenhuma poltrona selecionada.";
    }


    if (studentSection) {

      studentSection.style.display =
        "none";
    }


    if (confirmButton) {

      confirmButton.disabled =
        true;
    }


    if (seatSection) {

      seatSection.style.display =
        "block";
    }


    await renderSeats(somenteVisualizacao, motivoVisualizacao);
  }


  // ==========================================================
  // RESERVAS FIXAS: OCULTAR NOMES ATÉ A ABERTURA DA LISTA
  // ==========================================================

  const NOMES_RESERVAS_FIXAS = new Set([
    'andreynia alessandra silva carvalho',
    'miriã souza de jesus',
    'jamily cristine almeida ataíde dos santos',
    'heitor bruno de oliveira',
    'nilmar pereira da silva',
    'samara souza de oliveira'
  ]);

  function ocultarNomeReservaFixaAntesDaAbertura(nome, data) {
    if (!nome || !data) return false;

    const nomeNormalizado = String(nome).trim().toLocaleLowerCase('pt-BR');
    const hora = horaAtualEmMinutos();
    const amanha = obterDataLocal(1);
    const dia = diaDaSemanaLocal(0);

    // Domingo: a lista de segunda abre às 18h.
    // Segunda a quinta: a lista do dia seguinte abre às 22h.
    // Sexta e sábado não há abertura para o dia seguinte.
    const horarioAbertura = dia === 0
      ? 18 * 60
      : 22 * 60;

    // As reservas fixas são criadas para o próximo dia.
    // Antes da abertura, ocultamos somente o nome na visualização pública.
    return hora < horarioAbertura
      && data === amanha
      && NOMES_RESERVAS_FIXAS.has(nomeNormalizado);
  }


  // ==========================================================
  // MOSTRAR 48 POLTRONAS
  // ==========================================================

  async function renderSeats(
    somenteVisualizacao = false,
    motivoVisualizacao = "fechadas"
  ) {

    if (!seatMap) {

      console.error(
        "Elemento #seat-map não encontrado."
      );

      return;
    }


    seatMap.innerHTML = "";


    if (
      !selectedBus ||
      !currentDate
    ) {

      return;
    }

    if (selectedBus === "VAN") return;


    const busNoMomento =
      selectedBus;

    const dataNoMomento =
      currentDate;


    const resultado =
      await buscarPoltronasOcupadas(
        busNoMomento,
        dataNoMomento
      );


    if (
      busNoMomento !== selectedBus ||
      dataNoMomento !== currentDate
    ) {

      return;
    }


    if (resultado.erro) {

      seatMap.innerHTML = `
        <p>
          Não foi possível carregar
          as poltronas.
        </p>
      `;

      console.error(
        resultado.erro
      );

      return;
    }


    const ocupadas =
      resultado.ocupadas;


    // ========================================================
    // 48 POLTRONAS
    // ========================================================

    for (
      let poltrona = 1;
      poltrona <= 48;
      poltrona++
    ) {

      const button =
        document.createElement("button");


      button.type = "button";

      button.className = "seat";

      const nomeReservanteOriginal =
        (resultado.nomesPorPoltrona || {})[poltrona] || "";

      const nomeReservante =
        ocultarNomeReservaFixaAntesDaAbertura(
          nomeReservanteOriginal,
          dataNoMomento
        )
          ? ""
          : nomeReservanteOriginal;

      if (somenteVisualizacao) {
        button.disabled = true;
        button.classList.add("locked-view");

        const partesNome = nomeReservante.trim().split(/\s+/).filter(Boolean);
        const nomeCurto = partesNome.length >= 2
          ? `${partesNome[0]} ${partesNome[1]}`
          : (partesNome[0] || "");

        button.innerHTML = nomeReservante
          ? `<span class="seat-lock">🔒</span><span class="seat-number">${poltrona}</span><span class="seat-reserved-name">${escapeHtml(nomeCurto)}</span>`
          : `<span class="seat-lock">🔒</span><span class="seat-number">${poltrona}</span>`;
      } else if (nomeReservante) {
        const partesNomeAberto = nomeReservante.trim().split(/\s+/).filter(Boolean);
        const nomeCurtoAberto = partesNomeAberto.length >= 2
          ? `${partesNomeAberto[0]} ${partesNomeAberto[1]}`
          : (partesNomeAberto[0] || "");
        button.innerHTML = `
          <span class="seat-number">${poltrona}</span>
          <span class="seat-reserved-name" title="${escapeHtml(nomeReservante)}">${escapeHtml(nomeCurtoAberto)}</span>
        `;
      } else {
        button.textContent = poltrona;
      }

      // Primeiras quatro poltronas identificadas como prioritárias.
      if (poltrona <= 4) {
        button.classList.add("priority-seat");
        button.title = "Poltrona prioritária";
      }


      // POLTRONA OCUPADA

      if (
        ocupadas.includes(poltrona)
      ) {

        button.disabled = true;

        button.classList.add(
          "occupied"
        );

      }


      // POLTRONA DISPONÍVEL

      else if (!somenteVisualizacao) {

        button.classList.add(
          "available"
        );


        button.addEventListener(
          "click",
          function () {

            selecionarPoltrona(
              poltrona
            );

          }
        );
      }


      seatMap.appendChild(
        button
      );
    }

    if (somenteVisualizacao && selectedSeatLabel) {
      selectedSeatLabel.textContent =
        motivoVisualizacao === "lotado"
          ? "🔒 Ônibus lotado. Visualização das poltronas."
          : "🔒 Visualização: reservas fechadas neste horário.";
    }
  }


  // ==========================================================
  // SELECIONAR POLTRONA
  // ==========================================================

  function selecionarPoltrona(
    poltrona
  ) {

    if (!reservaPodeSerFeita(currentDate)) {
      mostrarAvisoEncerramento();
      return;
    }

    selectedSeat =
      Number(poltrona);


    if (seatMap) {

      const seats =
        seatMap.querySelectorAll(
          ".seat"
        );


      seats.forEach(
        seat => {

          seat.classList.remove(
            "selected"
          );

        }
      );


      seats.forEach(
        seat => {

          if (
            Number(
              seat.textContent
            ) === selectedSeat
          ) {

            seat.classList.add(
              "selected"
            );
          }
        }
      );
    }


    if (selectedSeatLabel) {

      selectedSeatLabel.textContent =
        `Poltrona ${selectedSeat} selecionada.`;
    }


    if (studentSection) {

      studentSection.style.display =
        "block";
    }


    if (confirmButton) {

      confirmButton.disabled =
        false;
    }


    mostrarMensagem("");
  }


// ========================================================
// SUGESTÃO DE NOMES DOS UNIVERSITÁRIOS ATIVOS
// ========================================================

function esconderSugestoesUniversitarios() {
  if (!nameSuggestions) return;
  nameSuggestions.innerHTML = "";
  nameSuggestions.style.display = "none";
  if (nameInput) nameInput.setAttribute("aria-expanded", "false");
}

function selecionarSugestaoUniversitario(nome) {
  if (!nameInput) return;
  nameInput.value = nome || "";
  esconderSugestoesUniversitarios();
  ultimaBuscaNomes = nome || "";
  nameInput.focus();
}

async function carregarSugestoesUniversitarios(valor) {

  if (!nameSuggestions || !supabaseClient) return;

  const busca = (valor || "").trim();

  if (busca === ultimaBuscaNomes && nameSuggestions.style.display === "block") return;
  ultimaBuscaNomes = busca;

  try {
    const { data, error } = await supabaseClient.rpc(
      "buscar_universitarios_ativos",
      { p_busca: busca }
    );

    if (error) {
      console.error("Erro ao buscar nomes:", error);
      esconderSugestoesUniversitarios();
      return;
    }

    nameSuggestions.innerHTML = "";

    const alunos = Array.isArray(data) ? data : [];

    if (!alunos.length) {
      esconderSugestoesUniversitarios();
      return;
    }

    alunos.forEach(function (aluno) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "name-suggestion-item";
      button.setAttribute("role", "option");
      button.textContent = aluno.nome;
      button.addEventListener("mousedown", function (event) {
        event.preventDefault();
        selecionarSugestaoUniversitario(aluno.nome);
      });
      nameSuggestions.appendChild(button);
    });

    nameSuggestions.style.display = "block";
    if (nameInput) nameInput.setAttribute("aria-expanded", "true");
  } catch (erro) {
    console.error("Erro ao carregar sugestões:", erro);
    esconderSugestoesUniversitarios();
  }
}

if (nameInput) {
  nameInput.addEventListener("focus", function () {
    clearTimeout(timerBuscaNomes);
    timerBuscaNomes = setTimeout(function () {
      carregarSugestoesUniversitarios(nameInput.value);
    }, 100);
  });

  nameInput.addEventListener("input", function () {
    clearTimeout(timerBuscaNomes);
    timerBuscaNomes = setTimeout(function () {
      carregarSugestoesUniversitarios(nameInput.value);
    }, 180);
  });

  nameInput.addEventListener("blur", function () {
    setTimeout(esconderSugestoesUniversitarios, 180);
  });
}



  // ==========================================================
  // FAZER RESERVA
  // ==========================================================

  async function fazerReserva() {

    if (!supabaseClient) {

      mostrarMensagem(
        "Erro: sistema não conectado ao banco de dados.",
        "error"
      );

      return;
    }


    if (!currentDate) {

      mostrarMensagem(
        "Selecione a data da viagem.",
        "error"
      );

      return;
    }

    if (!reservaPodeSerFeita(currentDate)) {
      mostrarAvisoEncerramento();
      return;
    }


    if (!selectedBus) {

      mostrarMensagem(
        "Selecione um ônibus.",
        "error"
      );

      return;
    }


    if (selectedBus !== "VAN" && !selectedSeat) {

      mostrarMensagem(
        "Selecione uma poltrona.",
        "error"
      );

      return;
    }


    const nome =
      nameInput
        ? nameInput.value.trim()
        : "";


    const curso =
      courseInput
        ? courseInput.value.trim()
        : "";


    const instituicao =
      institutionInput
        ? institutionInput.value.trim()
        : "";


    // ========================================================
    // VALIDAÇÕES
    // ========================================================

    if (!nome) {

      mostrarMensagem(
        "Informe seu nome completo.",
        "error"
      );

      if (nameInput) {
        nameInput.focus();
      }

      return;
    }


    if (!curso) {

      mostrarMensagem(
        "Informe seu curso.",
        "error"
      );

      if (courseInput) {
        courseInput.focus();
      }

      return;
    }


    if (!instituicao) {

      mostrarMensagem(
        "Informe a instituição.",
        "error"
      );

      if (institutionInput) {
        institutionInput.focus();
      }

      return;
    }

    if (!instituicaoValida(instituicao)) {

      mostrarMensagem(
        "Selecione uma instituição cadastrada nas sugestões.",
        "error"
      );

      if (institutionInput) {
        institutionInput.focus();
      }

      return;
    }


    // Guarda os dados antes da chamada
    // para podermos mostrar a confirmação.

    const onibusReservado =
      selectedBus;

    const poltronaReservada =
      selectedSeat;

    const dataReservada =
      currentDate;


    if (confirmButton) {

      confirmButton.disabled =
        true;

      confirmButton.textContent =
        "Reservando...";
    }


    try {

      // Confere se o nome está na lista oficial de universitários autorizados.
      const { data: autorizacao, error: erroAutorizacao } = await supabaseClient.rpc(
        "validar_universitario",
        { p_nome: nome }
      );
      if (erroAutorizacao) {
        mostrarMensagem("Não foi possível validar seu cadastro. Tente novamente.", "error");
        return;
      }
      if (!autorizacao?.autorizado) {
        mostrarMensagem(autorizacao?.mensagem || "Nome não localizado na lista de universitários autorizados.", "error");
        return;
      }

      // Confere novamente a poltrona antes de enviar a reserva.
      if (onibusReservado !== "VAN") {
        const resultadoOcupacao = await buscarPoltronasOcupadas(Number(onibusReservado), dataReservada);
        const ocupadasAgora = resultadoOcupacao?.ocupadas || [];
        if (resultadoOcupacao?.erro) { mostrarMensagem("Não foi possível verificar a poltrona. Tente novamente.", "error"); return; }
        if (ocupadasAgora.includes(Number(poltronaReservada))) { mostrarMensagem("⚠️ Essa poltrona já está ocupada. Escolha outra poltrona.", "error"); await renderBuses(); return; }
      }

      if (onibusReservado === "VAN") {
        const resultadoVan = await buscarVagasVanOcupadas(dataReservada);
        const vagasOcupadas = resultadoVan?.ocupadas || [];

        if (resultadoVan?.erro) {
          mostrarMensagem("Não foi possível verificar a vaga da VAN. Tente novamente.", "error");
          return;
        }

        if (!poltronaReservada || Number(poltronaReservada) < 1 || Number(poltronaReservada) > VAN_CAPACIDADE) {
          mostrarMensagem("Selecione uma vaga da VAN entre V1 e V17.", "error");
          return;
        }

        if (vagasOcupadas.includes(Number(poltronaReservada))) {
          mostrarMensagem("⚠️ Essa vaga da VAN já está ocupada. Escolha outra vaga.", "error");
          await renderBuses();
          return;
        }
      }

      // Impede segunda reserva ativa do mesmo aluno para a mesma data.
      const { data: reservasDoNome, error: erroNome } = await supabaseClient.rpc(
        "consultar_reservas_por_nome", { p_nome: nome }
      );
      if (erroNome) {
        mostrarMensagem("Não foi possível verificar suas reservas. Tente novamente.", "error");
        return;
      }
      const jaTemReserva = (reservasDoNome || []).some(r => r.data_viagem === dataReservada);
      if (jaTemReserva) {
        mostrarMensagem("⚠️ Você já possui uma reserva para esta data.", "error");
        return;
      }

      const ehUniRV =
        instituicao.trim().toLowerCase() === "unirv";

      if (ehUniRV && onibusReservado !== "VAN") {
        const { data: cota, error: erroCota } = await supabaseClient.rpc(
          "verificar_cota_unirv",
          { p_data: dataReservada, p_onibus: Number(onibusReservado) }
        );
        if (erroCota) { mostrarMensagem("Não foi possível verificar a disponibilidade da UniRV. Tente novamente.", "error"); return; }
        if (cota && cota.liberada === false) { mostrarMensagem(cota.mensagem || "As vagas da UniRV para este ônibus estão esgotadas.", "error"); return; }
      }

      const { data, error } = onibusReservado === "VAN"
        ? await supabaseClient.rpc("fazer_reserva", {
            p_data: dataReservada,
            p_nome: nome,
            p_curso: curso,
            p_instituicao: instituicao,
            p_onibus: null,
            p_poltrona: Number(poltronaReservada),
            p_tipo_transporte: "van"
          })
        : await supabaseClient.rpc("fazer_reserva_com_cota_unirv", {
            p_data: dataReservada,
            p_nome: nome,
            p_curso: curso,
            p_instituicao: instituicao,
            p_onibus: Number(onibusReservado),
            p_poltrona: Number(poltronaReservada),
            p_tipo_transporte: "onibus"
          });


      // ======================================================
      // ERRO
      // ======================================================

      if (error) {

        console.error(
          "Erro ao fazer reserva:",
          error
        );


        mostrarMensagem(
          error.message ||
          "Não foi possível realizar a reserva.",
          "error"
        );

        return;
      }


      console.log(
        "Reserva realizada:",
        data
      );


      // ======================================================
      // CÓDIGO DA RESERVA
      // ======================================================

      let codigo = "";

      function extrairCodigoReserva(valor) {
        if (!valor) return "";

        if (typeof valor === "string") {
          const texto = valor.trim();

          // Se for JSON retornado como string
          if (
            (texto.startsWith("{") && texto.endsWith("}")) ||
            (texto.startsWith("[") && texto.endsWith("]"))
          ) {
            try {
              return extrairCodigoReserva(JSON.parse(texto));
            } catch (_) {}
          }

          const encontrado = texto.match(/MU-[A-Z0-9]{8}/i);
          return encontrado ? encontrado[0].toUpperCase() : texto;
        }

        if (Array.isArray(valor)) {
          for (const item of valor) {
            const achado = extrairCodigoReserva(item);
            if (achado) return achado;
          }
          return "";
        }

        if (typeof valor === "object") {
          const campos = [
            "codigo_reserva",
            "codigo",
            "reservation_code",
            "fazer_reserva"
          ];

          for (const campo of campos) {
            const achado = extrairCodigoReserva(valor[campo]);
            if (achado) return achado;
          }

          // Última tentativa: procurar o código em qualquer valor do objeto.
          for (const valorCampo of Object.values(valor)) {
            const achado = extrairCodigoReserva(valorCampo);
            if (achado) return achado;
          }
        }

        return "";
      }

      codigo = extrairCodigoReserva(data);

      // Se o RPC realizou a reserva, mas não devolveu o código,
      // confirma a reserva pelo nome e recupera o código salvo no banco.
      if (!codigo && nome) {
        try {
          const consulta = await supabaseClient.rpc(
            "consultar_reservas_por_nome",
            { p_nome: nome }
          );

          if (!consulta.error && Array.isArray(consulta.data)) {
            const mesmaReserva = consulta.data.find((r) =>
              r.data_viagem === dataReservada &&
              (onibusReservado === "VAN"
                ? r.tipo_transporte === "van"
                : Number(r.onibus) === Number(onibusReservado) && Number(r.poltrona) === Number(poltronaReservada))
            );

            if (mesmaReserva) {
              codigo = mesmaReserva.codigo_reserva || "";
            }
          }
        } catch (erroConsulta) {
          console.error(
            "Não foi possível recuperar o código da reserva:",
            erroConsulta
          );
        }
      }

      // Nunca informa "sucesso" se não conseguimos confirmar a reserva.
      if (!codigo) {
        mostrarMensagem(
          "A reserva não pôde ser confirmada. O sistema não recebeu o código da reserva. Tente novamente.",
          "error"
        );
        return;
      }

      // ======================================================
      // MENSAGEM DE CONFIRMAÇÃO
      // ======================================================

      let textoSucesso = `

        <div class="success">

          <strong>
            Reserva realizada com sucesso! ✅
          </strong>

          <br><br>

          <strong>
            Data:
          </strong>

          ${formatarData(dataReservada)}

          <br>

          <strong>
            Transporte:
          </strong>

          ${onibusReservado === "VAN" ? "🚐 VAN – Excedentes" : `Ônibus ${buses[onibusReservado].numero}`}

          ${onibusReservado === "VAN" ? `
          <br>
          <strong>Vaga:</strong> V${poltronaReservada}
          ` : `
          <br>
          <strong>Motorista:</strong> ${buses[onibusReservado].motorista}
          <br>
          <strong>Poltrona:</strong> ${poltronaReservada}`}
      `;


      if (codigo) {

        textoSucesso += `

          <br>

          <strong>
            Código da reserva:
          </strong>

          <div class="reservation-code">${escapeHtml(codigo)}</div>

          <br><br>

          <small>
            🔎 Para consultar ou cancelar sua reserva, utilize a área
            <strong>“Consultar ou cancelar minha reserva”</strong> abaixo.
          </small>

        `;
      }


      textoSucesso += `

        </div>

      `;


      // ======================================================
      // MOSTRA A MENSAGEM
      // ======================================================

      mostrarMensagem(
        textoSucesso,
        "success"
      );


      // ======================================================
      // ESCONDE APENAS POLTRONAS
      // ======================================================

      if (seatSection) {

        seatSection.style.display =
          "none";
      }


      // ======================================================
      // NÃO ESCONDE studentSection!
      // A mensagem está dentro dele.
      // ======================================================

      if (studentSection) {

        studentSection.style.display =
          "block";
      }


      // ======================================================
      // LIMPA OS CAMPOS
      // ======================================================

      if (nameInput) {

        nameInput.value = "";
      }


      if (courseInput) {

        courseInput.value = "";
      }


      if (institutionInput) {

        institutionInput.value = "";
      }


      // Guarda a data para continuar na mesma tela
      currentDate =
        dataReservada;

      // Atualiza a ocupação antes de limpar a seleção.
      await renderBuses();

      selectedBus = null;
      selectedSeat = null;


    } catch (error) {

      console.error(
        error
      );


      mostrarMensagem(
        "Ocorreu um erro ao realizar a reserva.",
        "error"
      );


    } finally {

      if (confirmButton) {

        confirmButton.disabled =
          true;

        confirmButton.textContent =
          "Confirmar Reserva";
      }
    }
  }


  // ==========================================================
  // ESCAPAR TEXTO
  // ==========================================================

  function escapeHtml(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function obterNomeOnibus(onibus) {
    const bus = buses[Number(onibus)];

    if (!bus) {
      return `Ônibus ${onibus}`;
    }

    return `Ônibus ${bus.numero}`;
  }

  function obterMotorista(onibus) {
    const bus = buses[Number(onibus)];

    return bus ? bus.motorista : "";
  }


  // ==========================================================
  // ÁREA DE CONSULTA E CANCELAMENTO
  // ==========================================================

  function criarAreaConsultaCancelamento() {

    if (document.querySelector("#reservation-management")) {
      return;
    }

    if (!studentSection || !studentSection.parentNode) {
      return;
    }

    const section = document.createElement("section");

    section.id = "reservation-management";

    section.innerHTML = `
      <div class="reservation-management-box">

        <h2>🔎 Consultar ou cancelar minha reserva</h2>

        <p>
          Informe somente o código recebido ao fazer a reserva.
        </p>

        <div class="lookup-fields">

          <label for="lookup-code">
            Código da reserva
          </label>

          <input
            type="text"
            id="lookup-code"
            placeholder="Ex.: MU-ECE0DAB8"
            autocomplete="off"
          >

          <button
            type="button"
            id="lookup-button"
          >
            Consultar reserva
          </button>

        </div>

        <div class="forgot-code-area">

          <p>
            <strong>🔎 Não lembro o código?</strong>
          </p>

          <p>
            Digite seu nome completo e escolha a data da reserva.
          </p>

          <label for="lookup-name-only">
            Nome completo
          </label>

          <input
            type="text"
            id="lookup-name-only"
            placeholder="Digite seu nome completo"
            autocomplete="name"
          >

          <label for="lookup-date">
            Data da reserva
          </label>

          <input
            type="date"
            id="lookup-date"
          >

          <button
            type="button"
            id="lookup-name-button"
          >
            🔍 Localizar minha reserva
          </button>

        </div>

        <div
          id="lookup-result"
          class="lookup-result"
        ></div>

      </div>
    `;

    studentSection.insertAdjacentElement(
      "afterend",
      section
    );

    lookupCodeInput =
      document.querySelector("#lookup-code");

    lookupButton =
      document.querySelector("#lookup-button");

    lookupNameOnlyInput =
      document.querySelector("#lookup-name-only");

    lookupDateInput =
      document.querySelector("#lookup-date");

    lookupNameButton =
      document.querySelector("#lookup-name-button");

    lookupResult =
      document.querySelector("#lookup-result");

    if (lookupDateInput) {
      const hoje = new Date();

      const ano = hoje.getFullYear();
      const mes = String(hoje.getMonth() + 1).padStart(2, "0");
      const dia = String(hoje.getDate()).padStart(2, "0");

      lookupDateInput.min =
        `${ano}-${mes}-${dia}`;
    }

    if (lookupButton) {
      lookupButton.addEventListener(
        "click",
        consultarMinhaReserva
      );
    }

    if (lookupNameButton) {
      lookupNameButton.addEventListener(
        "click",
        localizarReservaPorNome
      );
    }
  }


  // ==========================================================
  // LOCALIZAR RESERVA PELO NOME
  // ==========================================================

  async function localizarReservaPorNome() {

    const nome =
      lookupNameOnlyInput
        ? lookupNameOnlyInput.value.trim()
        : "";

    const data =
      lookupDateInput
        ? lookupDateInput.value
        : "";

    if (!nome || !data) {
      if (lookupResult) {
        lookupResult.innerHTML = `
          <div class="error">
            Informe seu nome completo e escolha a data da reserva.
          </div>
        `;
      }
      return;
    }

    if (!supabaseClient) {
      if (lookupResult) {
        lookupResult.innerHTML = `
          <div class="error">
            Sistema não conectado ao banco de dados.
          </div>
        `;
      }
      return;
    }

    if (lookupNameButton) {
      lookupNameButton.disabled = true;
      lookupNameButton.textContent = "Localizando...";
    }

    if (lookupResult) {
      lookupResult.innerHTML =
        "<p>🔎 Localizando sua reserva...</p>";
    }

    try {

      const {
        data: resultado,
        error
      } =
        await supabaseClient.rpc(
          "consultar_reservas_por_nome_data_v2",
          {
            p_nome: nome,
            p_data: data
          }
        );

      if (error) {
        console.error(
          "Erro ao localizar reserva:",
          error
        );

        if (lookupResult) {
          lookupResult.innerHTML = `
            <div class="error">
              Não foi possível localizar a reserva.
              <br><br>
              Tente novamente.
            </div>
          `;
        }
        return;
      }

      const reservas =
        Array.isArray(resultado)
          ? resultado
          : [];

      if (!reservas.length) {
        if (lookupResult) {
          lookupResult.innerHTML = `
            <div class="error">
              ❌ Nenhuma reserva ativa foi encontrada
              para este nome e esta data.
            </div>
          `;
        }
        return;
      }

      lookupResult.innerHTML = `
        <div class="reservation-result">

          <h3>📋 Reserva localizada</h3>

          <p>
            Encontramos ${reservas.length}
            reserva${reservas.length > 1 ? "s" : ""}.
          </p>

          ${reservas.map(reserva => `
            <div class="reservation-item">

              <p>
                <strong>Data:</strong>
                ${formatarData(reserva.data_viagem)}
              </p>

              <p>
                <strong>Instituição:</strong>
                ${escapeHtml(reserva.instituicao || "")}
              </p>

              <p>
                <strong>Ônibus:</strong>
                ${escapeHtml(
                  reserva.tipo_transporte === "van"
                    ? "VAN – EXCEDENTES"
                    : obterNomeOnibus(reserva.onibus)
                )}
              </p>

              <p>
                <strong>Motorista:</strong>
                ${escapeHtml(
                  reserva.tipo_transporte === "van"
                    ? "—"
                    : obterMotorista(reserva.onibus)
                )}
              </p>

              <p>
                <strong>Poltrona:</strong>
                ${escapeHtml(reserva.poltrona)}
              </p>

              <p>
                <strong>Código da reserva:</strong>
              </p>

              <div class="reservation-code">
                ${escapeHtml(reserva.codigo_reserva)}
              </div>

              ${positionUnirv(reserva.instituicao) ? `
              <button
                type="button"
                class="remanej-button remanej-by-name"
                data-code="${escapeHtml(reserva.codigo_reserva)}"
              >
                🔄 Remanejar minha reserva
              </button>` : ''}

              <button
                type="button"
                class="cancel-button cancel-by-name"
                data-code="${escapeHtml(reserva.codigo_reserva)}"
              >
                ❌ Cancelar esta reserva
              </button>

              <hr>

            </div>
          `).join("")}

          <p>
            <small>
              Guarde este código para consultar ou cancelar sua reserva.
            </small>
          </p>

        </div>
      `;

      document
        .querySelectorAll(".remanej-by-name")
        .forEach(function (button) {
          button.addEventListener("click", async function () {
            const codigoReserva = button.dataset.code || "";
            const reserva = reservas.find(r =>
              String(r.codigo_reserva || "").toLowerCase() === codigoReserva.toLowerCase()
            );
            if (!reserva) return;
            await mostrarReservaParaRemanejamento(reserva);
          });
        });

      document
        .querySelectorAll(".cancel-by-name")
        .forEach(function (button) {

          button.addEventListener(
            "click",
            async function () {

              const confirmar =
                window.confirm(
                  "Tem certeza que deseja cancelar esta reserva?"
                );

              if (!confirmar) return;

              const codigoReserva =
                button.dataset.code || "";

              await cancelarMinhaReserva(
                codigoReserva
              );
            }
          );
        });

    } catch (error) {

      console.error(
        "Erro inesperado ao localizar reserva:",
        error
      );

      if (lookupResult) {
        lookupResult.innerHTML = `
          <div class="error">
            Ocorreu um erro ao localizar a reserva.
          </div>
        `;
      }

    } finally {

      if (lookupNameButton) {
        lookupNameButton.disabled = false;
        lookupNameButton.textContent =
          "🔍 Localizar minha reserva";
      }
    }
  }



  async function mostrarReservaParaRemanejamento(reserva) {
    if (!lookupResult) return;

    reservaConsultaAtual = reserva;

    const instituicaoUnirv = positionUnirv(reserva.instituicao);
    const tipoAtual = reserva.tipo_transporte || (reserva.onibus == null ? 'van' : 'onibus');
    const transporteAtual = tipoAtual === 'van' ? 'VAN – EXCEDENTES' : obterNomeOnibus(reserva.onibus);
    const motoristaAtual = tipoAtual === 'van' ? '—' : obterMotorista(reserva.onibus);
    const assentoAtual = tipoAtual === 'van' ? 'V' + reserva.poltrona : reserva.poltrona;

    lookupResult.innerHTML = `
      <div class="reservation-result">
        <h3>📋 Sua reserva</h3>

        <p><strong>Nome:</strong> ${escapeHtml(reserva.nome)}</p>
        <p><strong>Curso:</strong> ${escapeHtml(reserva.curso)}</p>
        <p><strong>Instituição:</strong> ${escapeHtml(reserva.instituicao)}</p>
        <p><strong>Data:</strong> ${formatarData(reserva.data_viagem)}</p>
        <p><strong>Ônibus:</strong> ${escapeHtml(transporteAtual)}</p>
        <p><strong>Motorista:</strong> ${escapeHtml(motoristaAtual)}</p>
        <p><strong>Poltrona:</strong> ${escapeHtml(assentoAtual)}</p>
        <p><strong>Código da reserva:</strong></p>
        <div class="reservation-code">${escapeHtml(reserva.codigo_reserva)}</div>

        ${instituicaoUnirv ? `
        <button type="button" class="remanej-button" id="open-remanejamento">
          🔄 Remanejar minha reserva
        </button>

        <div id="remanejamento-box" class="remanejamento-box hidden">
          <strong>🔄 Escolha o novo destino</strong>
          <p class="remanejamento-help">Disponível das 22h00 às 16h59. Das 17h00 às 21h59, fica fechado.</p>

          <label for="remanej-tipo">Tipo de transporte</label>
          <select id="remanej-tipo">
            <option value="onibus">Ônibus</option>
            <option value="van">VAN – Excedentes</option>
          </select>

          <label for="remanej-onibus">Ônibus de destino</label>
          <select id="remanej-onibus">
            <option value="">Escolha o ônibus</option>
            <option value="1">Ônibus 0542 – Dheimes</option>
            <option value="2">Ônibus 0519 – Adalberto</option>
            <option value="3">Ônibus 0507 – Edson</option>
          </select>

          <label for="remanej-poltrona">Poltrona / vaga</label>
          <select id="remanej-poltrona">
            <option value="">Escolha o destino</option>
          </select>

          <div id="remanej-status" class="remanej-status"></div>
          <button type="button" class="remanej-button" id="remanej-confirmar">🔄 Confirmar remanejamento</button>
        </div>` : ''}

        <button type="button" class="cancel-button" id="cancel-my-reservation">
          ❌ Cancelar minha reserva
        </button>
      </div>
    `;

    const remanejButton = document.querySelector('#open-remanejamento');
    const remanejTipo = document.querySelector('#remanej-tipo');
    const remanejOnibus = document.querySelector('#remanej-onibus');
    const remanejConfirmar = document.querySelector('#remanej-confirmar');

    if (remanejTipo) remanejTipo.addEventListener('change', carregarDestinosRemanejamento);
    if (remanejOnibus) remanejOnibus.addEventListener('change', carregarDestinosRemanejamento);
    if (remanejConfirmar) remanejConfirmar.addEventListener('click', executarRemanejamentoAluno);

    if (remanejButton) {
      remanejButton.addEventListener('click', async function () {
        const box = document.querySelector('#remanejamento-box');
        if (!box) return;
        box.classList.toggle('hidden');
        if (!box.classList.contains('hidden')) {
          const origemTipo = reservaConsultaAtual.tipo_transporte || (reservaConsultaAtual.onibus == null ? 'van' : 'onibus');
          if (remanejTipo) remanejTipo.value = origemTipo === 'van' ? 'van' : 'onibus';
          if (remanejOnibus) remanejOnibus.value = origemTipo === 'onibus' && reservaConsultaAtual.onibus ? String(reservaConsultaAtual.onibus) : '';
          await carregarDestinosRemanejamento();
        }
      });
    }

    const cancelButton = document.querySelector('#cancel-my-reservation');
    if (cancelButton) {
      cancelButton.addEventListener('click', async function () {
        const confirmar = window.confirm('Tem certeza que deseja cancelar esta reserva?');
        if (!confirmar) return;
        await cancelarMinhaReserva(reserva.codigo_reserva);
      });
    }
  }

  function positionUnirv(instituicao) {
    const normalizado = String(instituicao || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
    return normalizado.includes('unirv');
  }

  function primeiroNome(nome) {
    const texto = String(nome || '').trim();
    if (!texto) return '';
    return texto.split(/\s+/)[0];
  }

  // ==========================================================
  // REMANEJAMENTO DA PRÓPRIA RESERVA - UNIRV
  // ==========================================================

  function remanejamentoPodeSerFeito(data) {
    if (!data) return false;
    const hora = horaAtualEmMinutos();
    const hoje = obterDataLocal(0);
    const amanha = obterDataLocal(1);

    if (hora >= 17 * 60 && hora < 22 * 60) return false;
    if (hora >= 22 * 60) return data === amanha;
    return data === hoje;
  }

  function mensagemJanelaRemanejamento(data) {
    const hora = horaAtualEmMinutos();
    const hoje = obterDataLocal(0);
    const amanha = obterDataLocal(1);

    if (hora >= 17 * 60 && hora < 22 * 60) {
      return '<strong>🔒 Remanejamento fechado neste horário.</strong><br><br>O remanejamento fica disponível das <strong>22h00 às 16h59</strong>.<br><br>Das <strong>17h00 às 21h59</strong>, o remanejamento fica fechado.';
    }
    if (hora < 17 * 60 && data !== hoje) {
      return '<strong>🔒 Esta reserva não pode ser remanejada agora.</strong><br><br>Até 16h59, o remanejamento é permitido somente para a viagem de hoje.';
    }
    if (hora >= 22 * 60 && data !== amanha) {
      return '<strong>🔒 Esta reserva não pode ser remanejada agora.</strong><br><br>A partir das 22h00, o remanejamento é aberto somente para a viagem de amanhã.';
    }
    return '';
  }

  async function carregarDestinosRemanejamento() {
    const tipo = document.querySelector('#remanej-tipo');
    const onibusSelect = document.querySelector('#remanej-onibus');
    const poltronaSelect = document.querySelector('#remanej-poltrona');
    const status = document.querySelector('#remanej-status');
    const button = document.querySelector('#remanej-confirmar');
    if (!tipo || !poltronaSelect || !reservaConsultaAtual) return;

    const data = reservaConsultaAtual.data_viagem;
    const tipoDestino = tipo.value;

    if (!remanejamentoPodeSerFeito(data)) {
      if (status) status.innerHTML = mensagemJanelaRemanejamento(data);
      if (button) button.disabled = true;
      return;
    }

    if (status) status.textContent = 'Carregando vagas disponíveis...';
    if (button) button.disabled = true;
    poltronaSelect.innerHTML = '<option value="">Carregando...</option>';
    if (onibusSelect) onibusSelect.style.display = tipoDestino === 'onibus' ? 'block' : 'none';

    try {
      if (tipoDestino === 'van') {
        const cotas = [];
        for (const n of [1,2,3]) {
          const r = await supabaseClient.rpc('verificar_cota_unirv', { p_data: data, p_onibus: n });
          if (r.error) throw r.error;
          cotas.push(r.data);
        }
        const todasEsgotadas = cotas.every(c => c && c.liberada === false);
        if (!todasEsgotadas) {
          poltronaSelect.innerHTML = '<option value="">VAN ainda não liberada</option>';
          if (status) status.innerHTML = '🔒 A VAN só pode ser escolhida quando as cotas UniRV dos 3 ônibus estiverem esgotadas.';
          return;
        }
        const r = await supabaseClient.rpc('consultar_vagas_van', { p_data: data });
        if (r.error) throw r.error;
        const ocupadas = new Map((r.data || []).map(x => [Number(x.poltrona), x.nome || '']));
        poltronaSelect.innerHTML = '<option value="">Escolha a vaga</option>';
        for (let i=1;i<=17;i++) {
          const op=document.createElement('option');
          op.value=String(i);
          if (ocupadas.has(i)) {
            const nomeOcupante = primeiroNome(ocupadas.get(i));
            op.textContent = `V${i} — ocupada${nomeOcupante ? ` — ${nomeOcupante}` : ''}`;
            op.disabled = true;
          } else {
            op.textContent = `V${i}`;
          }
          poltronaSelect.appendChild(op);
        }
        if (status) status.textContent = 'Escolha uma vaga livre da VAN.';
      } else {
        const onibus = Number(onibusSelect ? onibusSelect.value : 0);
        if (!onibus) {
          poltronaSelect.innerHTML = '<option value="">Escolha primeiro o ônibus</option>';
          if (status) status.textContent = 'Escolha o ônibus de destino.';
          return;
        }
        const r = await supabaseClient.rpc('consultar_poltronas_detalhadas', { p_data: data, p_onibus: onibus });
        if (r.error) throw r.error;
        const ocupadas = new Map((r.data || []).map(x => [Number(x.poltrona), x.nome || '']));
        poltronaSelect.innerHTML = '<option value="">Escolha a poltrona</option>';
        for (let i=1;i<=48;i++) {
          const op=document.createElement('option');
          op.value=String(i);
          if (ocupadas.has(i)) {
            const nomeOcupante = primeiroNome(ocupadas.get(i));
            op.textContent = `Poltrona ${i} — ocupada${nomeOcupante ? ` — ${nomeOcupante}` : ''}`;
            op.disabled = true;
          } else {
            op.textContent = `Poltrona ${i}`;
          }
          poltronaSelect.appendChild(op);
        }
        if (status) status.textContent = 'Escolha o ônibus e a poltrona livre.';
      }
      if (button) button.disabled = false;
    } catch (error) {
      console.error('Erro ao carregar destinos do remanejamento:', error);
      poltronaSelect.innerHTML = '<option value="">Não foi possível carregar</option>';
      if (status) status.innerHTML = '❌ Não foi possível carregar as vagas. Tente novamente.';
    }
  }

  async function executarRemanejamentoAluno() {
    if (!reservaConsultaAtual || !supabaseClient) return;
    const tipo = document.querySelector('#remanej-tipo');
    const onibusSelect = document.querySelector('#remanej-onibus');
    const poltronaSelect = document.querySelector('#remanej-poltrona');
    const button = document.querySelector('#remanej-confirmar');
    const status = document.querySelector('#remanej-status');
    const tipoDestino = tipo ? tipo.value : '';
    const novaPoltrona = Number(poltronaSelect ? poltronaSelect.value : 0);
    const novoOnibus = tipoDestino === 'van' ? null : Number(onibusSelect ? onibusSelect.value : 0);
    if (!novaPoltrona || (tipoDestino === 'onibus' && !novoOnibus)) {
      if (status) status.innerHTML = '<span class="error-inline">Escolha o destino completo.</span>';
      return;
    }
    if (!window.confirm('Confirma o remanejamento desta reserva para o novo destino?')) return;
    button.disabled = true; button.textContent = 'Remanejando...';
    if (status) status.textContent = 'Processando seu remanejamento...';
    try {
      const r = await supabaseClient.rpc('remanejar_minha_reserva_unirv', {
        p_codigo_reserva: reservaConsultaAtual.codigo_reserva,
        p_tipo_transporte: tipoDestino,
        p_novo_onibus: novoOnibus,
        p_nova_poltrona: novaPoltrona
      });
      if (r.error) throw r.error;
      const resultado = Array.isArray(r.data) ? r.data[0] : r.data;
      if (!resultado || resultado.sucesso === false) {
        if (status) status.innerHTML = `<span class="error-inline">❌ ${escapeHtml(resultado?.mensagem || 'Não foi possível remanejar sua reserva.')}</span>`;
        return;
      }
      // Atualiza a reserva em memória para refletir o novo destino.
      reservaConsultaAtual.tipo_transporte = tipoDestino;
      reservaConsultaAtual.onibus = novoOnibus;
      reservaConsultaAtual.poltrona = novaPoltrona;

      // Mostra a confirmação final fora do painel de remanejamento
      // e fecha a tela de escolha do novo destino.
      const mensagemSucesso = `
        <div class="success">
          <strong>✅ Remanejamento realizado com sucesso!</strong>
          <br><br>
          Sua reserva foi alterada para
          <strong>${escapeHtml(tipoDestino === 'van' ? 'VAN – EXCEDENTES' : obterNomeOnibus(novoOnibus))}</strong>,
          <strong>${escapeHtml(tipoDestino === 'van' ? 'V' + novaPoltrona : 'poltrona ' + novaPoltrona)}</strong>.
        </div>
      `;

      // Evita que uma validação antiga do campo de código substitua
      // a confirmação de sucesso por uma mensagem vermelha.
      if (lookupCodeInput) {
        lookupCodeInput.value = reservaConsultaAtual.codigo_reserva || '';
      }

      // Fecha imediatamente o painel de remanejamento e deixa somente
      // a confirmação final visível para o aluno.
      const remanejBox = document.querySelector('#remanejamento-box');
      if (remanejBox) remanejBox.classList.add('hidden');
      if (lookupResult) {
        lookupResult.innerHTML = mensagemSucesso;
        lookupResult.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      // Não chamar consultarMinhaReserva() aqui.
    } catch (error) {
      console.error('Erro no remanejamento do aluno:', error);
      if (status) status.innerHTML = `<span class="error-inline">❌ ${escapeHtml(error.message || 'Não foi possível remanejar sua reserva.')}</span>`;
    } finally {
      button.disabled = false; button.textContent = '🔄 Confirmar remanejamento';
    }
  }

  // ==========================================================
  // CONSULTAR MINHA RESERVA
  // ==========================================================

  async function consultarMinhaReserva() {

    const codigo =
      lookupCodeInput
        ? lookupCodeInput.value.trim()
        : "";

    if (!codigo) {
      if (lookupResult) {
        lookupResult.innerHTML = `
          <div class="error">
            Informe o código da reserva.
          </div>
        `;
      }

      return;
    }

    if (!supabaseClient) {
      if (lookupResult) {
        lookupResult.innerHTML = `
          <div class="error">
            Sistema não conectado ao banco de dados.
          </div>
        `;
      }

      return;
    }

    if (lookupButton) {
      lookupButton.disabled = true;
      lookupButton.textContent = "Consultando...";
    }

    if (lookupResult) {
      lookupResult.innerHTML =
        "<p>🔎 Consultando sua reserva...</p>";
    }

    try {

      const {
        data,
        error
      } =
        await supabaseClient.rpc(
          "consultar_minha_reserva_por_codigo_v2",
          {
            p_codigo: codigo
          }
        );

      if (error) {
        console.error(
          "Erro ao consultar reserva:",
          error
        );

        if (lookupResult) {
          lookupResult.innerHTML = `
            <div class="error">
              Não foi possível consultar a reserva.
              <br><br>
              Tente novamente.
            </div>
          `;
        }

        return;
      }

      const reserva =
        Array.isArray(data)
          ? data[0]
          : data;

      if (!reserva) {
        if (lookupResult) {
          lookupResult.innerHTML = `
            <div class="error">
              ❌ Reserva não encontrada ou já cancelada.
              <br><br>
              Confira o código informado.
            </div>
          `;
        }

        return;
      }

      reservaConsultaAtual = reserva;
      const instituicaoUnirv = positionUnirv(reserva.instituicao);
      const tipoAtual = reserva.tipo_transporte || (reserva.onibus == null ? 'van' : 'onibus');
      const transporteAtual = tipoAtual === 'van' ? 'VAN – EXCEDENTES' : obterNomeOnibus(reserva.onibus);
      const motoristaAtual = tipoAtual === 'van' ? '—' : obterMotorista(reserva.onibus);
      const assentoAtual = tipoAtual === 'van' ? 'V' + reserva.poltrona : reserva.poltrona;

      lookupResult.innerHTML = `
        <div class="reservation-result">

          <h3>📋 Sua reserva</h3>

          <p>
            <strong>Nome:</strong>
            ${escapeHtml(reserva.nome)}
          </p>

          <p>
            <strong>Curso:</strong>
            ${escapeHtml(reserva.curso)}
          </p>

          <p>
            <strong>Instituição:</strong>
            ${escapeHtml(reserva.instituicao)}
          </p>

          <p>
            <strong>Data:</strong>
            ${formatarData(reserva.data_viagem)}
          </p>

          <p>
            <strong>Ônibus:</strong>
            ${escapeHtml(transporteAtual)}
          </p>

          <p>
            <strong>Motorista:</strong>
            ${escapeHtml(motoristaAtual)}
          </p>

          <p>
            <strong>Poltrona:</strong>
            ${escapeHtml(assentoAtual)}
          </p>

          <p>
            <strong>Código da reserva:</strong>
          </p>

          <div class="reservation-code">
            ${escapeHtml(reserva.codigo_reserva)}
          </div>

          ${instituicaoUnirv ? `
          <button type="button" class="remanej-button" id="open-remanejamento">
            🔄 Remanejar minha reserva
          </button>

          <div id="remanejamento-box" class="remanejamento-box hidden">
            <strong>🔄 Escolha o novo destino</strong>
            <p class="remanejamento-help">Disponível das 22h00 às 16h59. Das 17h00 às 21h59, fica fechado.</p>

            <label for="remanej-tipo">Tipo de transporte</label>
            <select id="remanej-tipo">
              <option value="onibus">Ônibus</option>
              <option value="van">VAN – Excedentes</option>
            </select>

            <label for="remanej-onibus">Ônibus de destino</label>
            <select id="remanej-onibus">
              <option value="">Escolha o ônibus</option>
              <option value="1">Ônibus 0542 – Dheimes</option>
              <option value="2">Ônibus 0519 – Adalberto</option>
              <option value="3">Ônibus 0507 – Edson</option>
            </select>

            <label for="remanej-poltrona">Poltrona / vaga</label>
            <select id="remanej-poltrona">
              <option value="">Escolha o destino</option>
            </select>

            <div id="remanej-status" class="remanej-status"></div>
            <button type="button" class="remanej-button" id="remanej-confirmar">🔄 Confirmar remanejamento</button>
          </div>` : ''}

          <button
            type="button"
            class="cancel-button"
            id="cancel-my-reservation"
          >
            ❌ Cancelar minha reserva
          </button>

        </div>
      `;

      const remanejButton = document.querySelector('#open-remanejamento');
      const remanejTipo = document.querySelector('#remanej-tipo');
      const remanejOnibus = document.querySelector('#remanej-onibus');
      const remanejConfirmar = document.querySelector('#remanej-confirmar');

      if (remanejTipo) remanejTipo.addEventListener('change', carregarDestinosRemanejamento);
      if (remanejOnibus) remanejOnibus.addEventListener('change', carregarDestinosRemanejamento);
      if (remanejConfirmar) remanejConfirmar.addEventListener('click', executarRemanejamentoAluno);
      if (remanejButton) {
        remanejButton.addEventListener('click', async function () {
          const box = document.querySelector('#remanejamento-box');
          if (!box) return;
          box.classList.toggle('hidden');
          if (!box.classList.contains('hidden')) {
            const origemTipo = reservaConsultaAtual.tipo_transporte || (reservaConsultaAtual.onibus == null ? 'van' : 'onibus');
            if (remanejTipo) remanejTipo.value = origemTipo === 'van' ? 'van' : 'onibus';
            if (remanejOnibus) remanejOnibus.value = origemTipo === 'onibus' && reservaConsultaAtual.onibus ? String(reservaConsultaAtual.onibus) : '';
            await carregarDestinosRemanejamento();
          }
        });
      }

      const cancelButton =
        document.querySelector(
          "#cancel-my-reservation"
        );

      if (cancelButton) {
        cancelButton.addEventListener(
          "click",
          async function () {

            const confirmar =
              window.confirm(
                "Tem certeza que deseja cancelar esta reserva?"
              );

            if (!confirmar) {
              return;
            }

            await cancelarMinhaReserva(
              codigo
            );
          }
        );
      }

    } catch (error) {

      console.error(
        "Erro inesperado:",
        error
      );

      if (lookupResult) {
        lookupResult.innerHTML = `
          <div class="error">
            Ocorreu um erro ao consultar sua reserva.
          </div>
        `;
      }

    } finally {

      if (lookupButton) {
        lookupButton.disabled = false;
        lookupButton.textContent =
          "Consultar reserva";
      }
    }
  }


  // ==========================================================
  // CANCELAR MINHA RESERVA
  // ==========================================================

  async function cancelarMinhaReserva(
    codigo
  ) {

    if (!supabaseClient) {
      if (lookupResult) {
        lookupResult.innerHTML = `
          <div class="error">
            Sistema não conectado ao banco de dados.
          </div>
        `;
      }

      return;
    }

    if (lookupResult) {
      lookupResult.innerHTML =
        "<p>⏳ Cancelando sua reserva...</p>";
    }

    try {

      const {
        data,
        error
      } =
        await supabaseClient.rpc(
          "cancelar_minha_reserva_por_codigo",
          {
            p_codigo: codigo
          }
        );

      if (error) {
        console.error(
          "Erro ao cancelar reserva:",
          error
        );

        if (lookupResult) {
          lookupResult.innerHTML = `
            <div class="error">
              Não foi possível cancelar a reserva.
              <br><br>
              Tente novamente.
            </div>
          `;
        }

        return;
      }

      const resultado =
        Array.isArray(data)
          ? data[0]
          : data;

      if (
        !resultado ||
        resultado.sucesso === false
      ) {
        if (lookupResult) {
          lookupResult.innerHTML = `
            <div class="error">
              ❌ ${
                escapeHtml(
                  resultado?.mensagem ||
                  "Reserva não encontrada."
                )
              }
            </div>
          `;
        }

        return;
      }

      if (lookupResult) {
        lookupResult.innerHTML = `
          <div class="success">

            <strong>
              Reserva cancelada com sucesso! ✅
            </strong>

            <br><br>

            <strong>Data:</strong>
            ${formatarData(resultado.data_viagem)}

            <br>

            <strong>Ônibus:</strong>
            ${escapeHtml(
              obterNomeOnibus(resultado.onibus)
            )}

            <br>

            <strong>Poltrona:</strong>
            ${escapeHtml(resultado.poltrona)}

            <br><br>

            Sua reserva não está mais ativa.

          </div>
        `;
      }

      if (
        currentDate ===
        resultado.data_viagem
      ) {
        await renderBuses();
      }

    } catch (error) {

      console.error(
        "Erro inesperado ao cancelar:",
        error
      );

      if (lookupResult) {
        lookupResult.innerHTML = `
          <div class="error">
            Ocorreu um erro ao cancelar a reserva.
          </div>
        `;
      }
    }
  }


  // ==========================================================
  // FORMATAR DATA
  // ==========================================================

  function formatarData(
    data
  ) {

    if (!data) {
      return "";
    }


    const partes =
      data.split("-");


    if (
      partes.length !== 3
    ) {

      return data;
    }


    return `${partes[2]}/${partes[1]}/${partes[0]}`;
  }


  // ==========================================================
  // INICIALIZAÇÃO
  // ==========================================================

  function inicializarPagina() {

    iniciarSupabase();

    carregarInstituicoesEnsino();


    // Esconde inicialmente
    if (seatSection) {

      seatSection.style.display =
        "none";
    }


    if (studentSection) {

      studentSection.style.display =
        "none";
    }


    if (confirmButton) {

      confirmButton.disabled =
        true;
    }


    if (!dateInput) {

      console.error(
        "Elemento #date não encontrado."
      );

      return;
    }


    // ========================================================
    // DATA
    // ========================================================

    atualizarLimitesData();

    async function sincronizarConfigTesteLocal() {
      if (window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
        return;
      }
      try {
        const resp = await fetch("/api/config-teste", { cache: "no-store" });
        if (resp.ok) {
          window.__configTesteLocal = await resp.json();
          if (typeof window.__atualizarPainelTesteUI === "function") {
            window.__atualizarPainelTesteUI(window.__configTesteLocal);
          }
        }
      } catch (_) {}
    }

    // Define a data inicial conforme a nova regra de abertura:
    // domingo às 18h para segunda; segunda a quinta às 22h para o dia seguinte;
    // sexta e sábado não abrem listas para o fim de semana.
    const dataInicial = obterProximaDataViagemAtual();

    currentDate = dataInicial;
    if (dateInput) dateInput.value = formatarDataParaCampo(currentDate);
    if (dateCalendar) dateCalendar.value = currentDate;

    sincronizarConfigTesteLocal().then(() => {
      const novaData = obterProximaDataViagemAtual();
      if (novaData && novaData !== currentDate) {
        currentDate = novaData;
        if (dateInput) dateInput.value = formatarDataParaCampo(currentDate);
        if (dateCalendar) dateCalendar.value = currentDate;
      }
      atualizarLimitesData();
      if (!reservaPodeSerFeita(currentDate)) {
        mostrarAvisoEncerramento();
      } else {
        mostrarMensagem("");
      }
      renderBuses();
    });

    let estadoAberturaAnterior = reservaPodeSerFeita(currentDate);

    // Recarrega automaticamente a cada 2 segundos (2000 ms)
    setInterval(async function () {

      await sincronizarConfigTesteLocal();

      atualizarLimitesData();

      const dataCampo = converterCampoParaData(dateInput.value);
      if (dataCampo) {
        currentDate = dataCampo;
        const abertaAgora = reservaPodeSerFeita(currentDate);

        if (!abertaAgora) {
          if (studentSection) {
            studentSection.style.display = "none";
          }
          if (confirmButton) {
            confirmButton.disabled = true;
          }
          mostrarAvisoEncerramento();
        } else if (!estadoAberturaAnterior && abertaAgora) {
          // Acabou de abrir a janela de reservas! Limpa o aviso de bloqueio.
          mostrarMensagem("");
        }

        estadoAberturaAnterior = abertaAgora;

        await renderBuses();

        // Se o mapa de poltronas de algum ônibus estiver aberto, atualiza a cada 2s também!
        if (selectedBus && seatSection && seatSection.style.display !== "none") {
          if (selectedBus === "VAN") {
            await renderVanSeats(!abertaAgora, "fechadas");
          } else {
            await renderSeats(!abertaAgora, "fechadas");
          }
        }
      }

    }, 2000);


    // ========================================================
    // MUDANÇA DA DATA
    // ========================================================

    async function tratarDataDigitada() {
      const data = converterCampoParaData(dateInput ? dateInput.value : "");

      if (!data) {
        if (dateInput && dateInput.value.trim()) {
          mostrarMensagem("Digite a data no formato DD/MM/AAAA. Ex.: 15/09/2026", "error");
        }
        return;
      }

      const hoje = obterDataLocal(0);
      const dataAlternativa = obterProximaDataViagemAtual();
      if (data !== hoje && data !== dataAlternativa) {
        mostrarMensagem("Você pode escolher somente a data da viagem disponível neste momento.", "error");
        dateInput.value = formatarDataParaCampo(currentDate);
        return;
      }

      aplicarDataSelecionada(data);
    }

    if (dateInput) {
      dateInput.addEventListener("change", tratarDataDigitada);
      dateInput.addEventListener("blur", tratarDataDigitada);
      dateInput.addEventListener("input", function () {
        let v = dateInput.value.replace(/\D/g, "").slice(0, 8);
        if (v.length > 4) v = v.slice(0, 2) + "/" + v.slice(2, 4) + "/" + v.slice(4);
        else if (v.length > 2) v = v.slice(0, 2) + "/" + v.slice(2);
        dateInput.value = v;
      });
    }

    if (openCalendarButton && dateCalendar) {
      openCalendarButton.addEventListener("click", function () {
        if (typeof dateCalendar.showPicker === "function") {
          dateCalendar.showPicker();
        } else {
          dateCalendar.focus();
          dateCalendar.click();
        }
      });
    }

    if (dateCalendar) {
      dateCalendar.addEventListener("change", function () {
        aplicarDataSelecionada(dateCalendar.value);
      });
    }


    // ========================================================
    // BOTÃO CONFIRMAR
    // ========================================================

    if (confirmButton) {

      confirmButton.addEventListener(
        "click",
        fazerReserva
      );
    }
  }


  // ==========================================================
  // INICIAR
  // ==========================================================

  criarAreaConsultaCancelamento();

  inicializarPagina();

}


const socket = io();

const telaEntrada = document.getElementById("telaEntrada");
const telaSala = document.getElementById("telaSala");
const formEntrada = document.getElementById("formEntrada");
const inputPin = document.getElementById("pin");
const inputNome = document.getElementById("nome");
const mensagemEntrada = document.getElementById("mensagemEntrada");
const nomeAluno = document.getElementById("nomeAluno");
const btnQuero = document.getElementById("btnQuero");
const statusAluno = document.getElementById("statusAluno");
const posicaoAluno = document.getElementById("posicaoAluno");
const mensagemSala = document.getElementById("mensagemSala");

let estado = {
    roomId: null,
    participantId: null,
    participantToken: null,
    nome: null,
    naFila: false
};

const sessaoSalva = localStorage.getItem("filaAlunoSessao");

if (sessaoSalva) {
    try {
        estado = JSON.parse(sessaoSalva);
        verificarSessao();
    } catch (error) {
        console.error(error);
        localStorage.removeItem("filaAlunoSessao");
    }
}

formEntrada.addEventListener("submit", async event => {
    event.preventDefault();

    mensagemEntrada.textContent = "Entrando...";

    try {
        const resposta = await fetch("/api/aluno/entrar", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                pin: inputPin.value.trim(),
                nome: inputNome.value.trim()
            })
        });

        const dados = await resposta.json();

        if (!resposta.ok) {
            throw new Error(
                dados.mensagem || "Erro ao entrar."
            );
        }

        estado = {
            roomId: dados.roomId,
            participantId: dados.participantId,
            participantToken: dados.participantToken,
            nome: dados.nome,
            naFila: false
        };

        localStorage.setItem(
            "filaAlunoSessao",
            JSON.stringify(estado)
        );

        mostrarSala();
        conectarSocket();

    } catch (error) {
        mensagemEntrada.textContent = error.message;
    }
});

async function verificarSessao() {
    try {
        const parametros = new URLSearchParams({
            roomId: estado.roomId,
            participantId: estado.participantId,
            participantToken: estado.participantToken
        });

        const resposta = await fetch(
            `/api/aluno/estado?${parametros}`
        );

        if (!resposta.ok) {
            throw new Error("Sessão inválida.");
        }

        const dados = await resposta.json();

        estado.nome = dados.nome;
        estado.naFila = dados.naFila;

        localStorage.setItem(
            "filaAlunoSessao",
            JSON.stringify(estado)
        );

        mostrarSala();
        conectarSocket();

    } catch (error) {
        console.error(error);

        localStorage.removeItem(
            "filaAlunoSessao"
        );
    }
}

function mostrarSala() {
    telaEntrada.classList.add("oculto");
    telaSala.classList.remove("oculto");

    nomeAluno.textContent =
        `Olá, ${estado.nome}`;

    atualizarBotao();
}

function mostrarInicio(){
    telaEntrada.classList.remove("oculto");
    telaSala.classList.add("oculto");
}

function conectarSocket() {
    if (!socket.connected) {
        socket.connect();
    }
}

socket.on("connect", () => {
    if (!estado.roomId) return;

    socket.emit("aluno:entrar-sala", {
        roomId: estado.roomId,
        participantId: estado.participantId,
        participantToken: estado.participantToken
    });
});

socket.on("fila-atualizada", fila => {
    atualizarPosicao(fila);
});

socket.on("entrou-na-fila", () => {
    estado.naFila = true;

    localStorage.setItem(
        "filaAlunoSessao",
        JSON.stringify(estado)
    );

    atualizarBotao();

    mensagemSala.textContent =
        "Você entrou na fila.";
});

socket.on("sala-encerrada", () => {
    console.log("Entrou aqui!");

    localStorage.removeItem("filaAlunoSessao");
    posicaoAluno.textContent = "";
    inputPin.value = "";
    atualizarBotao();
    mostrarInicio();
});

socket.on("fila-limpa", () => {
    estado.naFila = false;

    localStorage.setItem(
        "filaAlunoSessao",
        JSON.stringify(estado)
    );

    atualizarBotao();

    posicaoAluno.textContent = "";

    mensagemSala.textContent =
        "A fila foi liberada. Você pode clicar novamente.";
});

socket.on("erro", mensagem => {
    mensagemSala.textContent = mensagem;
    btnQuero.disabled = estado.naFila;
});

btnQuero.addEventListener("click", () => {
    if (estado.naFila) return;

    btnQuero.disabled = true;

    mensagemSala.textContent =
        "Registrando...";

    socket.emit("aluno:quero");
});

function atualizarBotao() {
    if (estado.naFila) {
        btnQuero.disabled = true;
        btnQuero.textContent = "VOCÊ ESTÁ NA FILA";
        statusAluno.textContent = "Aguarde sua vez.";
    } else {
        btnQuero.disabled = false;
        btnQuero.textContent = "EU QUERO";
        statusAluno.textContent =
            "Você ainda não entrou na fila.";
    }
}

function atualizarPosicao(fila) {
    const indice = fila.findIndex(
        aluno => aluno.id === estado.participantId
    );

    if (indice === -1) {
        posicaoAluno.textContent = "";
        return;
    }

    posicaoAluno.textContent =
        `Sua posição na fila: ${indice + 1}º`;
}

const socket = io({
    autoConnect: false
});

const telaEntrada = document.getElementById("telaEntrada");
const telaSala = document.getElementById("telaSala");
const formEntrada = document.getElementById("formEntrada");
const inputPin = document.getElementById("pin");
const inputNome = document.getElementById("nome");
const mensagemEntrada = document.getElementById("mensagemEntrada");
const nomeAluno = document.getElementById("nomeAluno");
const btnQuero = document.getElementById("btnQuero");
const btnSairFila = document.getElementById("btnSairFila");
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

let sessaoSalva = localStorage.getItem("filaAlunoSessao");

if (sessaoSalva) {
    try {
        estado = JSON.parse(sessaoSalva);
        verificarSessao();
    } catch (error) {
        console.error(error);
        localStorage.removeItem("filaAlunoSessao");
    }
} else {
    mostrarInicio();
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

btnSairFila.addEventListener("click", () => {
    estado.naFila = false;

    localStorage.setItem("filaAlunoSessao",
        JSON.stringify(estado)
    );

    socket.emit("aluno:sair-fila");
    mostrarInicio();
});

async function verificarSessao() {
    try {
        if (
            !estado.roomId ||
            !estado.participantId ||
            !estado.participantToken
        ) {
            localStorage.removeItem("filaAlunoSessao");
            mostrarInicio();
            return;
        }

        let parametros = new URLSearchParams({
            roomId: estado.roomId,
            participantId: estado.participantId,
            participantToken: estado.participantToken
        });

        const resposta = await fetch(`/api/aluno/estado?${parametros}`);

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
        socket.emit("atualizaSecaoAluno", estado);

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
    btnSairFila.classList.add("oculto");

    nomeAluno.textContent =
        `Olá, ${estado.nome}`;

    atualizarBotao();
    mensagemSala.textContent = "";
}

function mostrarInicio() {
    telaEntrada.classList.remove("oculto");
    telaSala.classList.add("oculto");
}

function conectarSocket() {
    if (!socket.connected) {
        socket.connect();
    }
}

socket.on("connect", () => {

    if (
        !estado.roomId ||
        !estado.participantId ||
        !estado.participantToken
    ) {
        socket.disconnect();
        return;
    }

    const dadosSessao = {
        roomId: estado.roomId,
        participantId: estado.participantId,
        participantToken: estado.participantToken
    };

    socket.emit("aluno:entrar-sala", dadosSessao);
    socket.emit("atualizaSecaoAluno", dadosSessao);
});


socket.on("fila-atualizada", fila => {
    atualizarPosicao(fila);
});

socket.on("entrou-na-fila", () => {
    estado.naFila = true;
    btnSairFila.classList.remove("oculto");

    atualizarBotao();

    mensagemSala.textContent =
        "Você entrou na fila.";
});

socket.on("sala-encerrada", () => {
    posicaoAluno.textContent = "";
    inputPin.value = "";
    mostrarInicio();
    btnSairFila.classList.add("oculto");
    mensagemSala.textContent = "";
    atualizarBotao();

    socket.emit("fila-atualizada");
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

btnQuero.addEventListener("click", async () => {
    btnQuero.disabled = true;

    mensagemSala.textContent =
        "Registrando...";

    conectarSocket();
    socket.emit("aluno:quero");
    atualizarBotao();
});

function atualizarBotao() {
    if (estado.naFila) {
        btnQuero.disabled = true;
        btnQuero.textContent = "VOCÊ ESTÁ NA FILA";
        statusAluno.textContent = "Aguarde sua vez.";
        btnSairFila.classList.remove("oculto");
    } else {
        btnQuero.disabled = false;
        btnQuero.textContent = "EU QUERO";
        statusAluno.textContent =
            "Você ainda não entrou na fila.";
        btnSairFila.classList.add("oculto");
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

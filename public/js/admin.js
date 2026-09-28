const socket = io({
    autoConnect: false
});

const telaCriar = document.getElementById("telaCriar");
const telaAdmin = document.getElementById("telaAdmin");
const inputAdminKey = document.getElementById("adminKey");
const btnCriarSala = document.getElementById("btnCriarSala");
const mensagemAdmin = document.getElementById("mensagemAdmin");
const pinSala = document.getElementById("pinSala");
const listaFila = document.getElementById("listaFila");
const filaVazia = document.getElementById("filaVazia");
const contador = document.getElementById("contador");
const btnLimpar = document.getElementById("btnLimpar");
const statusConexao = document.getElementById("statusConexao");
const btnEncerrar = document.getElementById("btnEncerrar");

let estado = {
    roomId: null,
    pin: null,
    adminToken: null
};

const salaSalva = localStorage.getItem(
    "filaAdminSessao"
);

if (salaSalva) {
    try {
        estado = JSON.parse(salaSalva);
        mostrarAdmin();
        conectarSocket();
    } catch (error) {
        console.error(error);
        localStorage.removeItem("filaAdminSessao");
    }
}

btnCriarSala.addEventListener("click", async () => {
    const adminKey = inputAdminKey.value.trim();

    if (!adminKey) {
        mensagemAdmin.textContent =
            "Digite a chave administrativa.";
        return;
    }

    btnCriarSala.disabled = true;
    mensagemAdmin.textContent = "Criando sala...";

    try {
        const resposta = await fetch(
            "/api/admin/criar-sala",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    adminKey
                })
            }
        );

        const dados = await resposta.json();

        if (!resposta.ok) {
            throw new Error(
                dados.mensagem ||
                "Não foi possível criar a sala."
            );
        }

        estado = {
            roomId: dados.roomId,
            pin: dados.pin,
            adminToken: dados.adminToken
        };

        localStorage.setItem(
            "filaAdminSessao",
            JSON.stringify(estado)
        );

        mostrarAdmin();
        conectarSocket();

    } catch (error) {
        mensagemAdmin.textContent = error.message;
        btnCriarSala.disabled = false;
    }
});

btnEncerrar.addEventListener("click", () => {
    // if(localStorage.getItem("filaAdminSessao")){
    //     localStorage.removeItem("filaAdminSessao");
    // }

    socket.emit("admin:encerrar-sala");
});

function mostrarAdmin() {
    telaCriar.classList.add("oculto");
    telaAdmin.classList.remove("oculto");

    pinSala.textContent = estado.pin;
}

function conectarSocket() {
    if (!socket.connected) {
        socket.connect();
    }
}

function MostarInicio(){
    telaCriar.classList.remove("oculto");
    telaAdmin.classList.add("oculto");
    inputAdminKey.value = "";
    localStorage.removeItem("filaAdminSessao");
}

socket.on("connect", () => {
    statusConexao.textContent = "Conectado";

    socket.emit("admin:entrar-sala", {
        roomId: estado.roomId,
        adminToken: estado.adminToken
    });
});

socket.on("disconnect", () => {
    statusConexao.textContent =
        "Desconectado. Tentando reconectar...";
});

socket.on("admin-conectado", dados => {
    pinSala.textContent = dados.pin;
});

socket.on("fila-atualizada", fila => {
    mostrarFila(fila);
});

socket.on("sala-encerrada", () => {
    mensagemAdmin.textContent = "";
    MostarInicio();
});

socket.on("fila-limpa", () => {
    mostrarFila([]);
});

socket.on("erro", mensagem => {
    mensagemAdmin.textContent = mensagem;
});

btnLimpar.addEventListener("click", () => {
    const confirmar = confirm(
        "Deseja realmente limpar toda a fila?"
    );

    if (!confirmar) return;

    socket.emit("admin:limpar-fila");
});

function mostrarFila(fila) {
    listaFila.innerHTML = "";

    contador.textContent =
        `${fila.length} ${fila.length === 1 ? "aluno" : "alunos"
        }`;

    if (fila.length === 0) {
        filaVazia.classList.remove("oculto");
        return;
    }

    filaVazia.classList.add("oculto");

    fila.forEach(aluno => {
        const li = document.createElement("li");
        li.textContent = aluno.nome;
        listaFila.appendChild(li);
    });
}

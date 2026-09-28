require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

function inicializarFirebase() {
    if (getApps().length > 0) {
        return getFirestore();
    }

    if (
        process.env.FIREBASE_PROJECT_ID &&
        process.env.FIREBASE_CLIENT_EMAIL &&
        process.env.FIREBASE_PRIVATE_KEY
    ) {
        console.log("Firebase: usando variáveis de ambiente.");

        initializeApp({
            credential: cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
            })
        });

        return getFirestore();
    }

    try {
        console.log("Firebase: usando firebase-service-account.json.");

        const serviceAccount = require("./firebase-service-account.json");

        initializeApp({
            credential: cert(serviceAccount)
        });

        return getFirestore();
    } catch (error) {
        console.error("ERRO: Não foi possível inicializar o Firebase.");
        console.error("Configure o firebase-service-account.json localmente ou as variáveis FIREBASE_* em produção.");
        console.error(error);
        process.exit(1);
    }
}

const db = inicializarFirebase();

const app = express();
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
    cors: {
        origin: true,
        credentials: true
    }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY;

if (!ADMIN_KEY) {
    console.error("ERRO: ADMIN_KEY não configurada.");
    console.error("Configure a ADMIN_KEY no arquivo .env local ou nas Environment Variables da Vercel.");
    process.exit(1);
}

function gerarPIN() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

function gerarToken() {
    return crypto.randomBytes(32).toString("hex");
}

function normalizarNome(nome) {
    return nome.trim().replace(/\s+/g, " ").substring(0, 100);
}

function validarNome(nome) {
    if (!nome || typeof nome !== "string") {
        return false;
    }

    const nomeNormalizado = normalizarNome(nome);

    return (
        nomeNormalizado.length >= 2 &&
        nomeNormalizado.length <= 100
    );
}

async function buscarSalaPorPIN(pin) {
    const snapshot = await db
        .collection("salas")
        .where("pin", "==", pin)
        .where("ativa", "==", true)
        .limit(1)
        .get();

    if (snapshot.empty) {
        return null;
    }

    const doc = snapshot.docs[0];

    return {
        id: doc.id,
        ref: doc.ref,
        data: doc.data()
    };
}

async function obterFila(roomId) {
    const salaRef = db.collection("salas").doc(roomId);

    const alunosSnapshot = await salaRef
        .collection("alunos")
        .where("naFila", "==", true)
        .get();

    const filaPromises = alunosSnapshot.docs.map(async alunoDoc => {
        const filaDoc = await salaRef
            .collection("fila")
            .doc(alunoDoc.id)
            .get();

        if (!filaDoc.exists) {
            return null;
        }

        const data = filaDoc.data();

        return {
            id: alunoDoc.id,
            nome: alunoDoc.data().nome,
            ordem: data.ordem
        };
    });

    const fila = await Promise.all(filaPromises);

    return fila
        .filter(item => item !== null)
        .sort((a, b) => a.ordem - b.ordem);
}

async function emitirFila(roomId) {
    const fila = await obterFila(roomId);

    io.to(`room:${roomId}`).emit("fila-atualizada", fila);

    return fila;
}

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.post("/api/admin/criar-sala", async (req, res) => {
    try {
        const { adminKey } = req.body;

        if (adminKey !== ADMIN_KEY) {
            return res.status(401).json({
                sucesso: false,
                mensagem: "Chave administrativa inválida."
            });
        }

        let pin;
        let salaExistente = true;

        while (salaExistente) {
            pin = gerarPIN();

            const consulta = await db
                .collection("salas")
                .where("pin", "==", pin)
                .where("ativa", "==", true)
                .limit(1)
                .get();

            salaExistente = !consulta.empty;
        }

        const roomId = crypto.randomUUID();
        const adminToken = gerarToken();

        await db
            .collection("salas")
            .doc(roomId)
            .set({
                pin,
                ativa: true,
                adminToken,
                proximaOrdem: 1,
                criadaEm: FieldValue.serverTimestamp()
            });

        return res.json({
            sucesso: true,
            roomId,
            pin,
            adminToken
        });
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            sucesso: false,
            mensagem: "Erro ao criar sala."
        });
    }
});

app.post("/api/aluno/entrar", async (req, res) => {
    try {
        const { pin, nome } = req.body;

        if (!pin || !validarNome(nome)) {
            return res.status(400).json({
                sucesso: false,
                mensagem: "Informe o PIN e um nome válido."
            });
        }

        const sala = await buscarSalaPorPIN(pin.toString().trim());

        if (!sala) {
            return res.status(404).json({
                sucesso: false,
                mensagem: "Sala não encontrada ou encerrada."
            });
        }

        const nomeNormalizado = normalizarNome(nome);
        const participantId = crypto.randomUUID();
        const participantToken = gerarToken();

        await sala.ref
            .collection("alunos")
            .doc(participantId)
            .set({
                nome: nomeNormalizado,
                token: participantToken,
                entrouEm: FieldValue.serverTimestamp(),
                naFila: false
            });

        return res.json({
            sucesso: true,
            roomId: sala.id,
            pin: sala.data.pin,
            participantId,
            participantToken,
            nome: nomeNormalizado
        });
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            sucesso: false,
            mensagem: "Erro ao entrar na sala."
        });
    }
});

app.get("/api/aluno/estado", async (req, res) => {
    try {
        const {
            roomId,
            participantId,
            participantToken
        } = req.query;

        if (!roomId || !participantId || !participantToken) {
            return res.status(400).json({
                sucesso: false,
                mensagem: "Dados incompletos."
            });
        }

        const alunoRef = db
            .collection("salas")
            .doc(roomId)
            .collection("alunos")
            .doc(participantId);

        const alunoDoc = await alunoRef.get();

        if (!alunoDoc.exists) {
            return res.status(404).json({
                sucesso: false,
                mensagem: "Aluno não encontrado."
            });
        }

        const aluno = alunoDoc.data();

        if (aluno.token !== participantToken) {
            return res.status(401).json({
                sucesso: false,
                mensagem: "Token inválido."
            });
        }

        return res.json({
            sucesso: true,
            nome: aluno.nome,
            naFila: aluno.naFila === true
        });
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            sucesso: false,
            mensagem: "Erro ao consultar estado."
        });
    }
});

io.on("connection", socket => {
    console.log("Socket conectado:", socket.id);

    socket.on("atualizaSecaoAluno", dados => {
        socket.data.roomId = dados.roomId,
            socket.data.participantId = dados.participantId,
            socket.data.participantToken = dados.participantToken
    });

    socket.on("aluno:entrar-sala", async dados => {
        try {
            const {
                roomId,
                participantId,
                participantToken
            } = dados;

            if (!roomId || !participantId || !participantToken) {
                socket.emit("erro", "Dados inválidos.");
                return;
            }

            const alunoRef = db
                .collection("salas")
                .doc(roomId)
                .collection("alunos")
                .doc(participantId);

            const alunoDoc = await alunoRef.get();

            if (!alunoDoc.exists) {
                socket.emit("erro", "Aluno não encontrado.");
                return;
            }

            const aluno = alunoDoc.data();

            if (aluno.token !== participantToken) {
                socket.emit("erro", "Token inválido.");
                return;
            }

            socket.join(`room:${roomId}`);

            socket.data.role = "aluno";
            socket.data.roomId = roomId;
            socket.data.participantId = participantId;


            socket.emit("conectado", {
                nome: aluno.nome,
                naFila: aluno.naFila === true
            });
            const fila = await obterFila(roomId);
            io.to(`room:${roomId}`).emit("fila-atualizada", fila);
        } catch (error) {
            console.error(error);
            socket.emit("erro", "Erro ao conectar à sala.");
        }
    });

    socket.on("admin:entrar-sala", async dados => {
        try {
            const {
                roomId,
                adminToken
            } = dados;

            if (!roomId || !adminToken) {
                socket.emit(
                    "erro",
                    "Dados administrativos inválidos."
                );
                return;
            }

            const salaRef = db
                .collection("salas")
                .doc(roomId);

            const salaDoc = await salaRef.get();

            if (!salaDoc.exists) {
                socket.emit(
                    "erro",
                    "Sala não encontrada."
                );
                return;
            }

            const sala = salaDoc.data();

            if (sala.adminToken !== adminToken) {
                socket.emit(
                    "erro",
                    "Token administrativo inválido."
                );
                return;
            }

            socket.join(`room:${roomId}`);

            socket.data.role = "admin";
            socket.data.roomId = roomId;

            const fila = await obterFila(roomId);

            socket.emit(
                "fila-atualizada",
                fila
            );

            socket.emit(
                "admin-conectado",
                {
                    pin: sala.pin
                }
            );
        } catch (error) {
            console.error(error);

            socket.emit(
                "erro",
                "Erro ao conectar à sala."
            );
        }
    });

    socket.on("admin:encerrar-sala", async () => {

        try {
            if (socket.data.role !== "admin") {
                socket.emit(
                    "erro",
                    "Apenas o administrador pode encerrar a sala."
                );
                return
            }

            const roomId = socket.data.roomId;

            const salaRef = db
                .collection("salas")
                .doc(roomId);


            await salaRef.update({
                ativa: false
            });
            await apagarSubselecoes(salaRef.collection("alunos"));
            await apagarSubselecoes(salaRef.collection("fila"));

            io.to(`room:${roomId}`).emit("fila-atualizada");
            io.to(`room:${roomId}`).emit("sala-encerrada");

        } catch (error) {
            console.error(error);
            socket.emit("erro", "Erro ao encerrar a sala");
        }
    });

    socket.on("aluno:quero", async () => {
        try {
            if (socket.data.role !== "aluno") {
                return;
            }

            const roomId =
                socket.data.roomId;

            const participantId =
                socket.data.participantId;

            const salaRef = db
                .collection("salas")
                .doc(roomId);

            const alunoRef = salaRef
                .collection("alunos")
                .doc(participantId);

            const alunoDoc =
                await alunoRef.get();

            if (!alunoDoc.exists) {
                socket.emit(
                    "erro",
                    "Aluno não encontrado."
                );
                return;
            }

            const aluno =
                alunoDoc.data();

            if (aluno.naFila === true) {
                socket.emit(
                    "erro",
                    "Você já está na fila."
                );
                return;
            }

            await db.runTransaction(
                async transaction => {
                    const salaDoc =
                        await transaction.get(
                            salaRef
                        );

                    const alunoDoc =
                        await transaction.get(
                            alunoRef
                        );

                    if (!salaDoc.exists) {
                        throw new Error(
                            "Sala não encontrada."
                        );
                    }

                    if (!alunoDoc.exists) {
                        throw new Error(
                            "Aluno não encontrado."
                        );
                    }

                    const alunoAtual =
                        alunoDoc.data();

                    if (alunoAtual.naFila === true) {
                        throw new Error(
                            "Aluno já está na fila."
                        );
                    }

                    const salaAtual =
                        salaDoc.data();

                    const ordem =
                        salaAtual.proximaOrdem || 1;

                    const filaRef =
                        salaRef
                            .collection("fila")
                            .doc(participantId);

                    transaction.set(
                        filaRef,
                        {
                            participantId,
                            nome: alunoAtual.nome,
                            ordem,
                            entrouEm:
                                FieldValue.serverTimestamp()
                        }
                    );

                    transaction.update(
                        alunoRef,
                        {
                            naFila: true
                        }
                    );

                    transaction.update(
                        salaRef,
                        {
                            proximaOrdem:
                                ordem + 1
                        }
                    );
                }
            );

            const fila = await obterFila(roomId);

            io.to(`room:${roomId}`).emit(
                "fila-atualizada",
                fila
            );

            socket.emit(
                "entrou-na-fila"
            );
        } catch (error) {
            console.error(error);

            socket.emit(
                "erro",
                error.message ||
                "Não foi possível entrar na fila."
            );
        }
    });

    socket.on("aluno:sair-fila", async () => {
        try {
            if (socket.data.role !== "aluno") {
                return;
            }

            const roomId =
                socket.data.roomId;

            const participantId =
                socket.data.participantId;

            const salaRef = db
                .collection("salas")
                .doc(roomId);

            const alunoRef = salaRef
                .collection("alunos")
                .doc(participantId);

            await alunoRef.update({
                naFila: false
            });

            const fila = await obterFila(roomId);
            io.to(`room:${roomId}`).emit("fila-atualizada", fila);

        } catch (error) {
            console.error(error);
            socket.emit("erro",
                "Erro ao sair da fila."
            );
        }
    });

    socket.on("admin:limpar-fila", async () => {
        try {
            if (socket.data.role !== "admin") {
                socket.emit(
                    "erro",
                    "Apenas o administrador pode limpar a fila."
                );
                return;
            }

            const roomId =
                socket.data.roomId;

            const salaRef = db
                .collection("salas")
                .doc(roomId);

            const alunosSnapshot =
                await salaRef
                    .collection("alunos")
                    .where(
                        "naFila",
                        "==",
                        true
                    )
                    .get();

            const filaSnapshot =
                await salaRef
                    .collection("fila")
                    .get();

            const batch =
                db.batch();

            alunosSnapshot.forEach(doc => {
                batch.update(
                    doc.ref,
                    {
                        naFila: false
                    }
                );
            });

            filaSnapshot.forEach(doc => {
                batch.delete(doc.ref);
            });

            await batch.commit();

            io.to(`room:${roomId}`)
                .emit("fila-limpa");

            io.to(`room:${roomId}`)
                .emit(
                    "fila-atualizada",
                    []
                );
        } catch (error) {
            console.error(error);

            socket.emit(
                "erro",
                "Erro ao limpar a fila."
            );
        }
    });

    socket.on("disconnect", () => {
        console.log(
            "Socket desconectado:",
            socket.id
        );
    });
});

async function apagarSubselecoes(ref) {
    while (true) {
        const snapshot = await ref.limit(500).get();

        if (snapshot.empty) break;
        const batch = db.batch();

        snapshot.forEach((doc => {
            batch.delete(doc.ref);
        }))

        await batch.commit();

        if (snapshot.sala < 500) {
            break;
        }
    }
}

if (require.main === module) {
    httpServer.listen(PORT, () => {
        console.log("======================================");
        console.log(" SISTEMA DE FILA DE ALUNOS");
        console.log("======================================");
        console.log(`Servidor: http://localhost:${PORT}`);
        console.log("======================================");
    });
}

module.exports = httpServer;
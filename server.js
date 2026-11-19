const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Variáveis sensíveis ficam no servidor (nunca enviadas ao front-end / F12)
const SENHA_ADMIN = process.env.SENHA_ADMIN || "123456";
const SENHA_MESTRA = process.env.SENHA_MESTRA || "SB2026#Mestre99";
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/fidelidade';

mongoose.connect(MONGO_URI)
    .then(() => console.log('Banco de dados conectado com sucesso!'))
    .catch(() => console.log('Erro de conexão com o banco.'));

// Modelo do Cliente (nunca apagado ao bloquear ou desbloquear)
const Cliente = mongoose.model('Cliente', {
    telefone: String,
    nome: String,
    coracoes: { type: Number, default: 0 },
    maxCoracoes: { type: Number, default: 7 }
});

// Modelo de Licença do Site
const Licenca = mongoose.model('Licenca', {
    chave: { type: String, unique: true },
    ativo: { type: Boolean, default: true }
});

async function obterLicenca() {
    let doc = await Licenca.findOne({ chave: 'studio_brendha' });
    if (!doc) {
        doc = await Licenca.create({ chave: 'studio_brendha', ativo: true });
    }
    return doc;
}

// Middleware que bloqueia operações do sistema quando suspenso
async function verificarLicenca(req, res, next) {
    try {
        const licenca = await obterLicenca();
        if (!licenca.ativo) {
            return res.status(403).json({
                sucesso: false,
                bloqueado: true,
                mensagem: 'Acesso temporariamente suspenso.'
            });
        }
        next();
    } catch (e) {
        return res.status(503).json({
            sucesso: false,
            mensagem: 'Serviço indisponível no momento.'
        });
    }
}

// Status público mínimo (apenas indica se está ativo ou bloqueado)
app.get('/api/status', async (req, res) => {
    try {
        const licenca = await obterLicenca();
        res.json({ online: true, ativo: Boolean(licenca.ativo) });
    } catch (e) {
        res.status(503).json({ online: false, ativo: false });
    }
});

// Login da Dona
app.post('/api/login', verificarLicenca, (req, res) => {
    const { senha } = req.body || {};
    if (typeof senha === 'string' && senha === SENHA_ADMIN) {
        return res.json({ sucesso: true });
    }
    return res.status(401).json({ sucesso: false, erro: 'Senha incorreta!' });
});

// Buscar cliente
app.get('/api/cliente/:telefone', verificarLicenca, async (req, res) => {
    let cliente = await Cliente.findOne({ telefone: req.params.telefone });
    if (!cliente) {
        cliente = new Cliente({
            telefone: req.params.telefone,
            nome: 'Cliente',
            coracoes: 0,
            maxCoracoes: 7
        });
        await cliente.save();
    }
    res.json(cliente);
});

// Cadastrar ou atualizar nome
app.post('/api/cadastrar', verificarLicenca, async (req, res) => {
    const { telefone, nome } = req.body || {};
    let cliente = await Cliente.findOne({ telefone });

    if (!cliente) {
        cliente = new Cliente({ telefone, nome, coracoes: 0, maxCoracoes: 7 });
    } else {
        cliente.nome = nome;
    }
    await cliente.save();
    res.json(cliente);
});

// Adicionar ou remover corações
app.post('/api/atualizar', verificarLicenca, async (req, res) => {
    const { telefone, acao } = req.body || {};
    let cliente = await Cliente.findOne({ telefone });

    if (!cliente) return res.status(404).json({ erro: 'Cliente não encontrado' });

    const limite = cliente.maxCoracoes || 7;
    if (acao === 'adicionar' && cliente.coracoes < limite) {
        cliente.coracoes += 1;
    } else if (acao === 'remover' && cliente.coracoes > 0) {
        cliente.coracoes -= 1;
    }

    await cliente.save();
    res.json(cliente);
});

// --- ROTAS PROTEGIDAS DO PROPRIETÁRIO (MASTER) ---

function autorizarMestre(req, res, next) {
    const { senhaMestra } = req.body || {};
    if (typeof senhaMestra !== 'string' || senhaMestra !== SENHA_MESTRA) {
        return res.status(401).json({ sucesso: false, erro: 'Acesso negado.' });
    }
    next();
}

// Resumo do site, status online/bloqueio e clientes cadastrados
app.post('/api/mestre/painel', autorizarMestre, async (req, res) => {
    try {
        const licenca = await obterLicenca();
        const clientes = await Cliente.find({}, { _id: 0, nome: 1, telefone: 1, coracoes: 1, maxCoracoes: 1 }).sort({ nome: 1 });
        const concluidos = clientes.filter(c => Number(c.coracoes || 0) >= Number(c.maxCoracoes || 7)).length;

        res.json({
            sucesso: true,
            site: {
                nome: 'Studio Brendha Elias',
                online: mongoose.connection.readyState === 1,
                ativo: Boolean(licenca.ativo),
                metaCoracoes: 7
            },
            resumo: {
                totalClientes: clientes.length,
                metasConcluidas: concluidos
            },
            clientes
        });
    } catch (e) {
        res.status(500).json({ sucesso: false, erro: 'Falha ao consultar dados.' });
    }
});

// Alternar bloqueio / desbloqueio do site (sem apagar nenhum cliente)
app.post('/api/mestre/alternar', autorizarMestre, async (req, res) => {
    try {
        const { ativo } = req.body || {};
        const licenca = await obterLicenca();
        licenca.ativo = typeof ativo === 'boolean' ? ativo : !licenca.ativo;
        await licenca.save();

        res.json({
            sucesso: true,
            ativo: Boolean(licenca.ativo),
            mensagem: licenca.ativo ? 'Site desbloqueado.' : 'Site bloqueado.'
        });
    } catch (e) {
        res.status(500).json({ sucesso: false, erro: 'Falha ao alterar status.' });
    }
});

// Página do painel master
app.get('/master', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'master.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}!`));

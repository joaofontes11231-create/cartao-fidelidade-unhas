const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// Senhas e banco ficam APENAS no servidor (nunca enviados ao front-end/F12)
const SENHA_ADMIN = process.env.SENHA_ADMIN || "123456";
const SENHA_MESTRA = process.env.SENHA_MESTRA || "MESTRE_ALTERE_AQUI";
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/fidelidade';

mongoose.connect(MONGO_URI)
    .then(() => console.log('Banco de dados conectado na nuvem com sucesso!'))
    .catch(() => console.log('Erro ao conectar no banco.'));

// Modelo do Cliente (preservado integralmente ao bloquear/desbloquear)
const Cliente = mongoose.model('Cliente', {
    telefone: String,
    nome: String,
    coracoes: { type: Number, default: 0 },
    maxCoracoes: { type: Number, default: 7 }
});

// Modelo de Licença do Site (apenas estado de bloqueio/desbloqueio)
const Licenca = mongoose.model('Licenca', {
    chave: { type: String, unique: true },
    ativo: { type: Boolean, default: true }
});

async function obterEstadoLicenca() {
    let doc = await Licenca.findOne({ chave: 'studio_brendha' });
    if (!doc) {
        doc = await Licenca.create({ chave: 'studio_brendha', ativo: true });
    }
    return doc;
}

// Middleware que bloqueia rotas do sistema quando a licença está suspensa
async function verificarLicenca(req, res, next) {
    try {
        const licenca = await obterEstadoLicenca();
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

// Rota pública leve para saber apenas se o site está ativo ou bloqueado
app.get('/api/status', async (req, res) => {
    try {
        const licenca = await obterEstadoLicenca();
        res.json({ ativo: Boolean(licenca.ativo) });
    } catch (e) {
        res.json({ ativo: true });
    }
});

// Rota de Login da Dona (respeita bloqueio)
app.post('/api/login', verificarLicenca, (req, res) => {
    const { senha } = req.body || {};
    if (typeof senha === 'string' && senha === SENHA_ADMIN) {
        return res.json({ sucesso: true });
    }
    return res.status(401).json({ sucesso: false, erro: 'Senha incorreta!' });
});

// Buscar cliente (respeita bloqueio)
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

// Cadastrar ou atualizar nome (respeita bloqueio)
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

// Adicionar ou remover corações (respeita bloqueio)
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

// --- ROTAS EXCLUSIVAS DO DONO (SENHA MESTRA) ---

// Consultar status atual exigindo senha mestra
app.post('/api/mestre/status', async (req, res) => {
    const { senhaMestra } = req.body || {};
    if (typeof senhaMestra !== 'string' || senhaMestra !== SENHA_MESTRA) {
        return res.status(401).json({ sucesso: false, erro: 'Acesso negado.' });
    }
    const licenca = await obterEstadoLicenca();
    res.json({ sucesso: true, ativo: Boolean(licenca.ativo) });
});

// Bloquear ou desbloquear o site sem apagar nenhum dado de clientes
app.post('/api/mestre/alternar', async (req, res) => {
    const { senhaMestra, ativo } = req.body || {};
    if (typeof senhaMestra !== 'string' || senhaMestra !== SENHA_MESTRA) {
        return res.status(401).json({ sucesso: false, erro: 'Acesso negado.' });
    }

    const licenca = await obterEstadoLicenca();
    licenca.ativo = typeof ativo === 'boolean' ? ativo : !licenca.ativo;
    await licenca.save();

    res.json({
        sucesso: true,
        ativo: Boolean(licenca.ativo),
        mensagem: licenca.ativo ? 'Site desbloqueado.' : 'Site bloqueado.'
    });
});

// Página do painel mestre
app.get('/master', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'master.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}!`));

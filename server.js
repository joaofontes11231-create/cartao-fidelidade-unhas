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
    ativo: { type: Boolean, default: true },
    motivo: { type: String, default: '' },
    subaviso: { type: String, default: '' }
});

async function obterLicenca() {
    let doc = await Licenca.findOne({ chave: 'studio_brendha' });
    if (!doc) {
        doc = await Licenca.create({ chave: 'studio_brendha', ativo: true, motivo: '', subaviso: '' });
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
                mensagem: 'Acesso temporariamente suspenso.',
                motivo: licenca.motivo || '',
                subaviso: licenca.subaviso || ''
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

// Status público (indica se está ativo/bloqueado e o motivo configurado)
app.get('/api/status', async (req, res) => {
    try {
        const licenca = await obterLicenca();
        res.json({
            online: true,
            ativo: Boolean(licenca.ativo),
            motivo: licenca.ativo ? '' : (licenca.motivo || ''),
            subaviso: licenca.ativo ? '' : (licenca.subaviso || '')
        });
    } catch (e) {
        res.status(503).json({ online: false, ativo: false, motivo: '', subaviso: '' });
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

// Listar clientes para a tela de clientes
app.get('/api/clientes', verificarLicenca, async (req, res) => {
    try {
        const clientes = await Cliente.find(
            {},
            { _id: 0, nome: 1, telefone: 1, coracoes: 1, maxCoracoes: 1 }
        ).sort({ nome: 1 });
        res.json(clientes);
    } catch (e) {
        res.status(500).json({ erro: 'Erro ao buscar clientes.' });
    }
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

// Remover cliente pelo painel da dona
app.delete('/api/cliente/:telefone', verificarLicenca, async (req, res) => {
    try {
        const telLimpo = String(req.params.telefone || '').trim();
        if (!telLimpo) {
            return res.status(400).json({ sucesso: false, erro: 'Telefone inválido.' });
        }
        const removido = await Cliente.findOneAndDelete({ telefone: telLimpo });
        if (!removido) {
            return res.status(404).json({ sucesso: false, erro: 'Cliente não encontrado.' });
        }
        return res.json({ sucesso: true, mensagem: 'Cliente removido.' });
    } catch (e) {
        return res.status(500).json({ sucesso: false, erro: 'Erro ao remover cliente.' });
    }
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

// Adicionar, remover ou zerar corações
app.post('/api/atualizar', verificarLicenca, async (req, res) => {
    const { telefone, acao } = req.body || {};
    let cliente = await Cliente.findOne({ telefone });

    if (!cliente) return res.status(404).json({ erro: 'Cliente não encontrado' });

    const limite = cliente.maxCoracoes || 7;
    if (acao === 'adicionar' && cliente.coracoes < limite) {
        cliente.coracoes += 1;
    } else if (acao === 'remover' && cliente.coracoes > 0) {
        cliente.coracoes -= 1;
    } else if (acao === 'zerar') {
        cliente.coracoes = 0;
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
                motivo: licenca.motivo || '',
                subaviso: licenca.subaviso || '',
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

// Alternar bloqueio / desbloqueio do site com motivo opcional
app.post('/api/mestre/alternar', autorizarMestre, async (req, res) => {
    try {
        const { ativo, motivo, subaviso } = req.body || {};
        const licenca = await obterLicenca();
        const proximoAtivo = typeof ativo === 'boolean' ? ativo : !licenca.ativo;
        licenca.ativo = proximoAtivo;

        if (!proximoAtivo) {
            licenca.motivo = typeof motivo === 'string' ? motivo.trim() : (licenca.motivo || '');
            licenca.subaviso = typeof subaviso === 'string' ? subaviso.trim() : 'Em breve nós voltamos';
        } else {
            licenca.motivo = '';
            licenca.subaviso = '';
        }

        await licenca.save();

        res.json({
            sucesso: true,
            ativo: Boolean(licenca.ativo),
            motivo: licenca.motivo || '',
            subaviso: licenca.subaviso || '',
            mensagem: licenca.ativo ? 'Site desbloqueado.' : 'Site bloqueado.'
        });
    } catch (e) {
        res.status(500).json({ sucesso: false, erro: 'Falha ao alterar status.' });
    }
});

// Adicionar coração, remover coração ou deletar cliente (apenas com senha mestra)
app.post('/api/mestre/cliente', autorizarMestre, async (req, res) => {
    try {
        const { telefone, acao } = req.body || {};
        if (!telefone || !acao) {
            return res.status(400).json({ sucesso: false, erro: 'Dados incompletos.' });
        }

        const telLimpo = String(telefone).trim();
        const cliente = await Cliente.findOne({ telefone: telLimpo });

        if (!cliente) {
            return res.status(404).json({ sucesso: false, erro: 'Cliente não encontrado.' });
        }

        if (acao === 'deletar') {
            await Cliente.deleteOne({ _id: cliente._id });
            return res.json({ sucesso: true, mensagem: 'Cliente removido.' });
        }

        const limite = Number(cliente.maxCoracoes || 7);
        if (acao === 'adicionar' && cliente.coracoes < limite) {
            cliente.coracoes += 1;
        } else if (acao === 'remover' && cliente.coracoes > 0) {
            cliente.coracoes -= 1;
        }

        await cliente.save();
        res.json({
            sucesso: true,
            mensagem: acao === 'adicionar' ? 'Coração adicionado.' : 'Coração removido.',
            coracoes: cliente.coracoes
        });
    } catch (e) {
        res.status(500).json({ sucesso: false, erro: 'Falha ao atualizar cliente.' });
    }
});

// Página do painel master
app.get('/master', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'master.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}!`));

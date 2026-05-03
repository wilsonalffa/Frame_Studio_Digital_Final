"""
Gera o documento Word com todas as funcionalidades do Frame Studio Digital
para fins de precificação.
"""

from docx import Document
from docx.shared import Pt, RGBColor, Inches, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
import datetime

# ── Paleta de cores ──────────────────────────────────────
AZUL_ESCURO = RGBColor(0x1A, 0x30, 0x51)   # #1A3051
AZUL_MEDIO  = RGBColor(0x24, 0x49, 0x7E)   # #24497E
OURO        = RGBColor(0xC9, 0xA8, 0x52)   # #C9A852
CINZA_TEXTO = RGBColor(0x44, 0x44, 0x44)
BRANCO      = RGBColor(0xFF, 0xFF, 0xFF)

doc = Document()

# ── Margens ───────────────────────────────────────────────
for section in doc.sections:
    section.top_margin    = Cm(2.0)
    section.bottom_margin = Cm(2.0)
    section.left_margin   = Cm(2.5)
    section.right_margin  = Cm(2.5)

# ── Helpers ───────────────────────────────────────────────
def set_cell_bg(cell, hex_color):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), hex_color)
    tcPr.append(shd)

def heading1(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(18)
    p.paragraph_format.space_after  = Pt(4)
    run = p.add_run(text)
    run.bold = True
    run.font.size = Pt(15)
    run.font.color.rgb = AZUL_ESCURO
    # Borda inferior simulada com sublinhado
    run.underline = False
    # Borda bottom usando XML
    pPr = p._p.get_or_add_pPr()
    pBdr = OxmlElement('w:pBdr')
    bottom = OxmlElement('w:bottom')
    bottom.set(qn('w:val'), 'single')
    bottom.set(qn('w:sz'), '6')
    bottom.set(qn('w:space'), '4')
    bottom.set(qn('w:color'), '1A3051')
    pBdr.append(bottom)
    pPr.append(pBdr)
    return p

def heading2(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(10)
    p.paragraph_format.space_after  = Pt(2)
    run = p.add_run(text)
    run.bold = True
    run.font.size = Pt(12)
    run.font.color.rgb = AZUL_MEDIO
    return p

def bullet(doc, text, level=0):
    p = doc.add_paragraph(style='List Bullet')
    p.paragraph_format.space_before = Pt(1)
    p.paragraph_format.space_after  = Pt(1)
    p.paragraph_format.left_indent  = Inches(0.25 + level * 0.25)
    run = p.add_run(text)
    run.font.size = Pt(10)
    run.font.color.rgb = CINZA_TEXTO
    return p

def normal(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after  = Pt(2)
    run = p.add_run(text)
    run.font.size = Pt(10)
    run.font.color.rgb = CINZA_TEXTO
    return p

def add_table_row(table, *cols, header=False):
    row = table.add_row()
    for i, val in enumerate(cols):
        cell = row.cells[i]
        cell.text = val
        for para in cell.paragraphs:
            para.paragraph_format.space_before = Pt(2)
            para.paragraph_format.space_after  = Pt(2)
            for run in para.runs:
                run.font.size = Pt(10)
                if header:
                    run.bold = True
                    run.font.color.rgb = BRANCO
                else:
                    run.font.color.rgb = CINZA_TEXTO
        if header:
            set_cell_bg(cell, '1A3051')

# ═══════════════════════════════════════════════════════════
#  CAPA
# ═══════════════════════════════════════════════════════════
p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.space_before = Pt(40)
run = p.add_run('FRAME STUDIO DIGITAL')
run.bold = True
run.font.size = Pt(26)
run.font.color.rgb = AZUL_ESCURO

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
run = p.add_run('Documento de Funcionalidades para Precificação')
run.font.size = Pt(13)
run.font.color.rgb = OURO
run.bold = True

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
run = p.add_run(f'Versão: Abril / 2026  ·  Gerado em: {datetime.date.today().strftime("%d/%m/%Y")}')
run.font.size = Pt(9)
run.font.color.rgb = RGBColor(0x88, 0x88, 0x88)

doc.add_page_break()

# ═══════════════════════════════════════════════════════════
#  SUMÁRIO EXECUTIVO
# ═══════════════════════════════════════════════════════════
heading1(doc, '1. Visão Geral do Sistema')
normal(doc,
    'O Frame Studio Digital é uma plataforma web SaaS multi-tenant voltada para lojas de molduraria e impressão. '
    'Combina ferramentas profissionais de análise de imagem, simulação visual e gestão comercial em um único sistema, '
    'acessado via navegador sem necessidade de instalação local.')

normal(doc, 'Tecnologias utilizadas:')
bullet(doc, 'Backend: Python 3 + Flask + Flask-SocketIO')
bullet(doc, 'Banco de dados: SQLite (local) ou Supabase/PostgreSQL (produção)')
bullet(doc, 'Inteligência Artificial: Google Gemini (via API REST)')
bullet(doc, 'Frontend: HTML5 + CSS3 + JavaScript (Canvas API, WebSocket)')
bullet(doc, 'Deploy: compatível com Render, Railway e qualquer PaaS Python')

doc.add_paragraph()

# ── Tabela resumo ──
t = doc.add_table(rows=0, cols=2)
t.style = 'Table Grid'
add_table_row(t, 'Módulo', 'Descrição Resumida', header=True)
modulos = [
    ('Imagem & Qualidade',        'Análise de resolução DPI e recomendação de tamanho de impressão'),
    ('Divisão & Sangria',         'Corte de imagem em painéis com margem de sangria configurável'),
    ('Simulação de Quadros',      'Mockup de moldura e passepartout sobre a imagem'),
    ('Simulação de Ambiente',     'Composição de múltiplos quadros em foto de ambiente'),
    ('Catálogo',                  'Biblioteca de itens e simulações persistida por loja'),
    ('CRM / Clientes',            'Cadastro, histórico e orçamento de clientes'),
    ('Câmera & Sincronização',    'Upload de imagem via celular sincronizado em tempo real'),
    ('Administração',             'Gestão de unidades, usuários e dashboard gerencial'),
    ('IA – Análise de Arte',      'Descrição automática de imagem e chat assistente via Gemini'),
    ('Autenticação',              'Login seguro, controle de sessão e permissões por papel'),
]
for m in modulos:
    add_table_row(t, *m)

doc.add_page_break()

# ═══════════════════════════════════════════════════════════
#  MÓDULO 1 — IMAGEM & QUALIDADE
# ═══════════════════════════════════════════════════════════
heading1(doc, '2. Módulo: Imagem & Qualidade')
normal(doc,
    'Ferramenta de análise de qualidade de imagem para impressão. '
    'Calcula o DPI efetivo conforme o tamanho de saída escolhido e orienta o usuário sobre a '
    'viabilidade de impressão com a resolução disponível.')

heading2(doc, '2.1 Upload e Suporte a Formatos')
bullet(doc, 'Drag-and-drop ou seleção por clique')
bullet(doc, 'Formatos suportados: JPG, PNG, WebP, HEIC/HEIF (conversão automática para JPEG), PDF (placeholder)')
bullet(doc, 'Validação de tamanho e tipo de arquivo')

heading2(doc, '2.2 Análise de Resolução')
bullet(doc, 'Cálculo automático de DPI para cada preset de tamanho (10×15, 13×18, 21×30, 30×40, 50×70, 60×90 cm)')
bullet(doc, 'Indicador visual de qualidade: Ótima / Boa / Regular / Baixa')
bullet(doc, 'Suporte a tamanho personalizado (largura e altura em cm)')
bullet(doc, 'Modo de ajuste: cobrir (cover) ou encaixar (fit) com cálculo de escala')
bullet(doc, 'Sincronização de proporção ao alterar dimensões (modo travado/destravado)')

heading2(doc, '2.3 Visualização Interativa')
bullet(doc, 'Preview em canvas com zoom, pan e escalonamento preciso')
bullet(doc, 'Controle de escala (slider) e deslocamento da imagem dentro do frame')
bullet(doc, 'Cores de fundo configuráveis para a área de corte (mat color)')
bullet(doc, 'Indicadores numéricos de DPI em tempo real')

heading2(doc, '2.4 Exportação')
bullet(doc, 'Download em JPG ou PDF (via jsPDF no navegador)')
bullet(doc, 'Modal de nomeação de arquivo com sugestão automática baseada no nome original')
bullet(doc, 'Integração: imagem é automaticamente reaproveitada nos demais módulos ao trocar de aba')

doc.add_paragraph()

# ═══════════════════════════════════════════════════════════
#  MÓDULO 2 — DIVISÃO & SANGRIA
# ═══════════════════════════════════════════════════════════
heading1(doc, '3. Módulo: Divisão & Sangria')
normal(doc,
    'Permite dividir uma imagem em múltiplos painéis (tela políptico) com controle de '
    'sangria entre peças, orientação e proporção personalizada.')

heading2(doc, '3.1 Modos de Divisão')
bullet(doc, 'Horizontal (N fatias laterais)')
bullet(doc, 'Vertical (N fatias empilhadas)')
bullet(doc, 'Grade (N × M colunas e linhas)')

heading2(doc, '3.2 Controles')
bullet(doc, 'Número de partes (1–20) por eixo')
bullet(doc, 'Sangria em mm por lado (0–50 mm)')
bullet(doc, 'Tamanho total da peça em cm (largura e altura)')
bullet(doc, 'Proporção individual ajustável por arrasto (divisão proporcional livre)')

heading2(doc, '3.3 Visualização')
bullet(doc, 'Preview em canvas com linhas de corte e indicação de sangria')
bullet(doc, 'Numeração de painéis e dimensões exibidas por painel')

heading2(doc, '3.4 Exportação')
bullet(doc, 'Download de todos os painéis em um ZIP (um JPG por painel)')
bullet(doc, 'Download em PDF com todos os painéis em páginas separadas')
bullet(doc, 'Botão de atalho "Ir para simulação" que aplica a composição no módulo de Simulação de Quadros')

doc.add_paragraph()

# ═══════════════════════════════════════════════════════════
#  MÓDULO 3 — SIMULAÇÃO DE QUADROS
# ═══════════════════════════════════════════════════════════
heading1(doc, '4. Módulo: Simulação de Quadros')
normal(doc,
    'Gera mockup profissional de como a imagem ficará com moldura e passepartout, '
    'com todos os parâmetros customizáveis em tempo real.')

heading2(doc, '4.1 Moldura')
bullet(doc, 'Espessura da moldura em mm (0–100 mm)')
bullet(doc, 'Paleta de 12 cores predefinidas (madeiras, preto, branco, dourado…)')
bullet(doc, 'Color picker livre para cor personalizada')

heading2(doc, '4.2 Passepartout (Passe-partout)')
bullet(doc, 'Ativação/desativação com toggle')
bullet(doc, 'Largura configurável em mm')
bullet(doc, 'Cor livre via color picker')

heading2(doc, '4.3 Dimensões')
bullet(doc, 'Largura e altura finais em cm (com moldura e passepartout incluídos)')
bullet(doc, 'Cálculo automático do espaço disponível para a arte')

heading2(doc, '4.4 Renderização')
bullet(doc, 'Canvas de alta fidelidade com sombra projetada e textura de moldura')
bullet(doc, 'Atualização em tempo real a cada ajuste de parâmetro')

heading2(doc, '4.5 Integração com Catálogo')
bullet(doc, 'Salvar simulação diretamente no catálogo da loja (persistência no backend)')
bullet(doc, 'Exportação JPG/PDF da simulação')

doc.add_paragraph()

# ═══════════════════════════════════════════════════════════
#  MÓDULO 4 — SIMULAÇÃO DE AMBIENTE
# ═══════════════════════════════════════════════════════════
heading1(doc, '5. Módulo: Simulação de Ambiente')
normal(doc,
    'Editor visual de composição de quadros sobre foto de ambiente (parede, sala, corredor). '
    'Múltiplos quadros com drag-and-drop e resize interativo.')

heading2(doc, '5.1 Ambiente (Fundo)')
bullet(doc, 'Upload de foto do ambiente pelo desktop')
bullet(doc, 'Biblioteca de ambientes predefinidos (quartos, salas) por loja via módulo Câmera')
bullet(doc, 'Ajuste do tamanho real da parede (largura e altura em cm) como referência de escala')

heading2(doc, '5.2 Quadros na Cena')
bullet(doc, 'Adicionar quantos quadros quiser à cena')
bullet(doc, 'Cada quadro possui: imagem de arte, dimensões em cm, moldura (cor e espessura), passepartout, sombra')
bullet(doc, 'Drag-and-drop para reposicionar qualquer quadro')
bullet(doc, 'Handles visuais de resize para redimensionar mantendo proporção')
bullet(doc, 'Seleção individual por clique com destaque de borda')

heading2(doc, '5.3 Guias e Alinhamento')
bullet(doc, 'Guias automáticas de alinhamento ao arrastar (centro, bordas)')
bullet(doc, 'Toggle para ativar/desativar guias')
bullet(doc, 'Trava de composição: move todos os quadros juntos como grupo')

heading2(doc, '5.4 Marca d\'Água')
bullet(doc, 'Marca d\'água de texto configurável (texto, tamanho, posição, rotação, opacidade)')
bullet(doc, 'Modo logo: substitui texto por imagem PNG/JPG da marca')
bullet(doc, 'Arrastar a marca d\'água diretamente no canvas')

heading2(doc, '5.5 Exportação')
bullet(doc, 'Download da composição em JPG de alta qualidade')
bullet(doc, 'Salvar simulação no catálogo da loja')

doc.add_paragraph()

# ═══════════════════════════════════════════════════════════
#  MÓDULO 5 — CATÁLOGO
# ═══════════════════════════════════════════════════════════
heading1(doc, '6. Módulo: Catálogo')
normal(doc,
    'Repositório digital de itens e simulações de cada unidade, persistido no backend. '
    'Permite organizar artes, molduras e composições aprovadas para reutilização rápida.')

heading2(doc, '6.1 Itens do Catálogo')
bullet(doc, 'Cadastro de itens com nome, descrição, imagem thumbnail e tags')
bullet(doc, 'Organização em pastas/categorias')
bullet(doc, 'Busca e filtragem por nome')
bullet(doc, 'CRUD completo: criar, editar, duplicar e excluir itens')

heading2(doc, '6.2 Simulações Salvas')
bullet(doc, 'Armazenamento de simulações de quadros e ambientes geradas nos outros módulos')
bullet(doc, 'Preview em miniatura das simulações salvas')
bullet(doc, 'Recarregar simulação nos módulos correspondentes com um clique')

heading2(doc, '6.3 Persistência')
bullet(doc, 'Dados salvos no backend por loja (tabela store_state, escopo "catalog")')
bullet(doc, 'Cache de validação no cliente para evitar chamadas desnecessárias')
bullet(doc, 'Migração automática de dados legados (localStorage/IndexedDB → backend)')

doc.add_paragraph()

# ═══════════════════════════════════════════════════════════
#  MÓDULO 6 — CRM / CLIENTES
# ═══════════════════════════════════════════════════════════
heading1(doc, '7. Módulo: CRM / Clientes')
normal(doc,
    'Sistema de gestão de relacionamento com clientes integrado à plataforma. '
    'Permite registrar atendimentos, orçamentos e histórico de cada cliente.')

heading2(doc, '7.1 Cadastro de Clientes')
bullet(doc, 'Nome, telefone, status (novo / em andamento / fechado / perdido) e observações')
bullet(doc, 'Busca por nome ou telefone')
bullet(doc, 'Atualização automática: cliente existente é atualizado ao criar nova consulta com mesmo telefone/nome')
bullet(doc, 'Exclusão com remoção em cascata de todo o histórico')

heading2(doc, '7.2 Consultas / Atendimentos')
bullet(doc, 'Registro de consultas vinculadas ao cliente')
bullet(doc, 'Campos: contexto, status, data, validade, preço, desconto, total')
bullet(doc, 'Histórico completo de atendimentos por cliente')
bullet(doc, 'Registro de pagamentos via campo JSON flexível')
bullet(doc, 'Preview de imagem anexada ao orçamento')

heading2(doc, '7.3 Dashboard por Loja')
bullet(doc, 'Totais de clientes, consultas e valor vendido (status "fechado")')
bullet(doc, 'Listagem paginada com total de consultas e data da última interação')

doc.add_paragraph()

# ═══════════════════════════════════════════════════════════
#  MÓDULO 7 — CÂMERA & SINCRONIZAÇÃO
# ═══════════════════════════════════════════════════════════
heading1(doc, '8. Módulo: Câmera & Sincronização em Tempo Real')
normal(doc,
    'Permite usar o celular como câmera para enviar fotos do ambiente diretamente para o desktop, '
    'usando WebSocket (Socket.IO) para sincronização instantânea.')

heading2(doc, '8.1 Fluxo de Uso')
bullet(doc, 'Desktop exibe QR Code com URL autenticada para o celular')
bullet(doc, 'Celular acessa a URL e captura foto pela câmera ou galeria')
bullet(doc, 'Imagem é enviada ao servidor, processada (compressão, redimensionamento) e transmitida via Socket.IO')
bullet(doc, 'Desktop recebe a imagem em tempo real e carrega na Simulação de Ambiente automaticamente')

heading2(doc, '8.2 Processamento de Imagem no Servidor')
bullet(doc, 'Compressão para JPEG com qualidade 85%')
bullet(doc, 'Redimensionamento máximo de 2000×2000 px (Pillow)')
bullet(doc, 'Persistência de metadados no banco (dimensões, tamanho, timestamp)')
bullet(doc, 'Cache em memória para acesso instantâneo pelo desktop')

heading2(doc, '8.3 Controle de Presença')
bullet(doc, 'Indicador de conexão: desktop e mobile conectados ou não')
bullet(doc, 'Heartbeat automático para manter sessão de câmera ativa')
bullet(doc, 'Limpeza automática de frames antigos (> 7 dias) via endpoint admin')

heading2(doc, '8.4 Segurança')
bullet(doc, 'URL de câmera com token de autenticação temporário (assinado com HMAC-SHA256)')
bullet(doc, 'Token com expiração configurable (padrão: 2 horas)')
bullet(doc, 'Validação de store_id e user_id em cada conexão Socket.IO')

doc.add_paragraph()

# ═══════════════════════════════════════════════════════════
#  MÓDULO 8 — ADMINISTRAÇÃO
# ═══════════════════════════════════════════════════════════
heading1(doc, '9. Módulo: Administração')
normal(doc,
    'Painel exclusivo para administradores. Gerencia unidades, usuários e visualiza '
    'indicadores consolidados de toda a rede.')

heading2(doc, '9.1 Gestão de Unidades')
bullet(doc, 'Listagem de todas as unidades com paginação e ordenação')
bullet(doc, 'Criação de nova unidade com usuário de acesso vinculado')
bullet(doc, 'Edição: nome, login, senha, papel (admin/user), status ativo/inativo')
bullet(doc, 'Desativação segura: impede desativar o próprio acesso ou o último admin')
bullet(doc, 'Exclusão de unidade com verificação de segurança (último admin protegido)')

heading2(doc, '9.2 Dashboard Gerencial')
bullet(doc, 'Totais consolidados: lojas ativas, clientes, consultas, valor vendido')
bullet(doc, 'Ranking de unidades por volume de vendas (status "fechado")')
bullet(doc, 'Por unidade: total de clientes, consultas, vendido, ticket médio, em andamento, fechados')
bullet(doc, 'Contagem de itens e simulações no catálogo por unidade')
bullet(doc, 'Data e contagem de logins por usuário')

doc.add_paragraph()

# ═══════════════════════════════════════════════════════════
#  MÓDULO 9 — IA (GEMINI)
# ═══════════════════════════════════════════════════════════
heading1(doc, '10. Módulo: Inteligência Artificial (Google Gemini)')
normal(doc,
    'Integração com a API do Google Gemini para análise automática de imagens e assistente de atendimento. '
    'Funcionalidades disponíveis conforme habilitação por ambiente.')

heading2(doc, '10.1 Descrição Automática de Imagem')
bullet(doc, 'Envio da imagem carregada em base64 para o Gemini Vision')
bullet(doc, 'Retorna uma palavra-chave descrevendo o assunto principal da arte (ex.: mar, família, floresta)')
bullet(doc, 'Usado para sugestão automática de nome e tags no catálogo')

heading2(doc, '10.2 Chat Assistente (Disponível, ativação configural)')
bullet(doc, 'Endpoint de proxy /api/chat que repassa mensagens ao Gemini com histórico de conversa')
bullet(doc, 'System prompt configurável por atendimento')
bullet(doc, 'Suporte a múltiplas rodadas de conversa (multi-turn)')
bullet(doc, 'Limite de 1000 tokens por resposta, temperatura 0.7')

heading2(doc, '10.3 Configuração')
bullet(doc, 'Modelo selecionável via variável de ambiente GEMINI_MODEL (padrão: gemini-2.5-flash)')
bullet(doc, 'Chave de API via GEMINI_API_KEY ou GOOGLE_API_KEY')

doc.add_paragraph()

# ═══════════════════════════════════════════════════════════
#  MÓDULO 10 — AUTENTICAÇÃO E SEGURANÇA
# ═══════════════════════════════════════════════════════════
heading1(doc, '11. Autenticação e Segurança')

heading2(doc, '11.1 Autenticação')
bullet(doc, 'Login por usuário/senha com hash bcrypt (Werkzeug)')
bullet(doc, 'Sessão persistente em cookie seguro (HttpOnly, SameSite=Lax, Secure em produção)')
bullet(doc, 'Duração de sessão: 7 dias, renovada a cada acesso')
bullet(doc, 'Logout com limpeza completa da sessão')
bullet(doc, 'Contador e data de último login por usuário')

heading2(doc, '11.2 Controle de Acesso')
bullet(doc, 'Dois papéis: admin e user')
bullet(doc, 'Decorator @login_required em todas as rotas protegidas')
bullet(doc, 'Decorator @admin_required em rotas administrativas')
bullet(doc, 'Isolamento de dados por store_id: cada loja vê apenas seus dados')
bullet(doc, 'Verificação de store ativo/inativo no login')

heading2(doc, '11.3 Segurança da API')
bullet(doc, 'Proteção contra OWASP Top 10 (validação de entrada, sem SQL injection via parâmetros)')
bullet(doc, 'Tokens de câmera assinados com HMAC-SHA256 e expiração')
bullet(doc, 'SECRET_KEY via variável de ambiente (sem fallback hardcoded em produção)')

doc.add_paragraph()

# ═══════════════════════════════════════════════════════════
#  INFRAESTRUTURA E DEPLOY
# ═══════════════════════════════════════════════════════════
heading1(doc, '12. Infraestrutura e Deploy')

heading2(doc, '12.1 Banco de Dados')
bullet(doc, 'SQLite para desenvolvimento local (sem configuração adicional)')
bullet(doc, 'Supabase/PostgreSQL para produção (multi-tenant com RLS)')
bullet(doc, 'Abstração de conexão: mesmo código funciona nos dois backends')
bullet(doc, 'Scripts SQL incluídos: schema, RLS lockdown, RLS multi-tenant, preparação de franchise')

heading2(doc, '12.2 Variáveis de Ambiente')
bullet(doc, 'GOOGLE_API_KEY / GEMINI_API_KEY — chave da IA')
bullet(doc, 'GEMINI_MODEL — modelo Gemini a usar')
bullet(doc, 'SECRET_KEY — chave de sessão Flask')
bullet(doc, 'DATABASE_URL — string de conexão Supabase/Postgres')
bullet(doc, 'PORT — porta do servidor (padrão 5000)')

heading2(doc, '12.3 Compatibilidade de Deploy')
bullet(doc, 'render.yaml incluso para deploy direto no Render.com')
bullet(doc, 'Compatível com Railway, Heroku e qualquer PaaS com suporte a Python/Gunicorn')
bullet(doc, 'Suporte a WebSocket (Socket.IO) em modo async/geventlet')

doc.add_paragraph()

# ═══════════════════════════════════════════════════════════
#  TABELA DE PRECIFICAÇÃO SUGERIDA
# ═══════════════════════════════════════════════════════════
heading1(doc, '13. Referência para Precificação')
normal(doc,
    'Tabela de referência de esforço por módulo/funcionalidade para apoio à precificação. '
    'Os valores de complexidade são relativos (1 = simples, 5 = muito complexo).')

doc.add_paragraph()
t2 = doc.add_table(rows=0, cols=4)
t2.style = 'Table Grid'
add_table_row(t2, 'Módulo / Funcionalidade', 'Complexidade', 'Escopo', 'Observações', header=True)

linhas_preco = [
    ('Autenticação + Controle de Acesso',   '3',  'Backend + Frontend', 'Login, sessão, roles, isolamento por loja'),
    ('Módulo Imagem & Qualidade',           '3',  'Frontend (Canvas)',   'Upload, DPI, presets, export JPG/PDF'),
    ('Módulo Divisão & Sangria',            '4',  'Frontend (Canvas)',   'Grid, orientação, sangria, ZIP de painéis'),
    ('Módulo Simulação de Quadros',         '3',  'Frontend (Canvas)',   'Moldura, passepartout, sombra, mockup'),
    ('Módulo Simulação de Ambiente',        '5',  'Frontend (Canvas)',   'Multi-quadro, drag-drop, resize, guias, watermark'),
    ('Módulo Catálogo',                     '3',  'Frontend + Backend',  'CRUD, pastas, simulações salvas, migração legado'),
    ('Módulo CRM / Clientes',               '4',  'Frontend + Backend',  'Cadastro, histórico, orçamento, pagamentos'),
    ('Módulo Câmera (QR + WebSocket)',       '5',  'Full-stack',          'Socket.IO, token HMAC, Pillow, presença, limpeza'),
    ('Módulo Administração + Dashboard',    '4',  'Full-stack',          'CRUD unidades, dashboard consolidado, proteções'),
    ('Integração IA (Gemini)',              '3',  'Backend',             'Proxy chat, describe-image, multi-turn'),
    ('Banco de Dados + Migração',           '3',  'Backend',             'SQLite/Postgres, RLS, scripts de schema'),
    ('Deploy + Infra (Render/Supabase)',    '2',  'DevOps',              'render.yaml, variáveis, WebSocket em produção'),
    ('UX / Design Responsivo',              '4',  'Frontend',            'SPA, sidebar, mobile nav, temas, acessibilidade'),
]

for linha in linhas_preco:
    add_table_row(t2, *linha)

doc.add_paragraph()
normal(doc,
    'Nota: a complexidade leva em conta integração entre módulos, sincronização de estado '
    'entre abas e requisitos de segurança multi-tenant.')

doc.add_paragraph()

# ─────────────────────────────────────────────────────────
p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
run = p.add_run('Frame Studio Digital  ·  Documento Confidencial  ·  Fast Frame Sorocaba')
run.font.size = Pt(8)
run.font.color.rgb = RGBColor(0xAA, 0xAA, 0xAA)
run.italic = True

# ── Salvar ───────────────────────────────────────────────
out_path = r'c:\Users\NitroWill\Desktop\Anotações Frame Studio\Frame Studio - Atual (backend estruturado)\Frame_Studio_Funcionalidades_Precificacao.docx'
doc.save(out_path)
print(f'Documento salvo em:\n{out_path}')

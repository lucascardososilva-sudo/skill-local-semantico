# Documento de Design e Proposta: Tema "Café" na UI do MCP

## Análise do Design do Frontend (Sanfran)
Ao analisar o arquivo `index.css` do frontend, identificamos que a plataforma utiliza o **"Cafe Design System"**, uma linguagem visual descrita como *warm, cozy e intentional*. 

### 1. Tipografia
- **Sans-serif (Principal):** `Poppins` (Pesos: 200 a 900). É usada para todo o texto corrido, títulos e botões, garantindo uma leitura limpa e moderna.
- **Monospace (Código/Tags):** `JetBrains Mono` (Pesos: 400 a 700). Usada para destacar caminhos de arquivos, trechos de código e identificadores técnicos.

### 2. Paleta de Cores (Tokens)
O sistema baseia-se em tons terrosos, cremes e dourados:
- **Surface (Fundo principal):** `#F9F7F5` (Creme muito claro)
- **Text (Texto principal):** `#3E2B1E` (Marrom escuro/Café)
- **Primary (Botões principais):** `#5D4432` (Marrom médio)
- **Secondary (Tags/Fundos suaves):** `#E9E3DD`
- **Muted (Textos secundários/Dicas):** `#8B7D6B`
- **Border (Divisórias/Bordas):** `#E0D8D0`
- **Accent (Destaques):** `#C9A84C` (Dourado/Mostarda)
- **Card (Fundo de painéis):** `#F5F1EC`

### 3. Estilos e Interações
- **Bordas (Radii):** Variam de `4px` (tags) até `16px` (modais e painéis grandes), passando uma sensação mais orgânica e menos rígida que o padrão web.
- **Scrollbars:** Estilizadas para combinar com o tema (fundo transparente, thumb com a cor `var(--cafe-border)`).
- **Animações:** Suaves (fadeIn, slide-in, fadeUpHeavy) com curvas cúbicas para parecerem naturais.

---

## Proposta para o App MCP
Atualmente, a UI do MCP (`mcp-app.css` e `skill-display.css`) utiliza um visual "Tech/Dark" genérico (fundos azul-escuro como `#1a1a2e`, texto claro `#e8e8e8` e botões indigo `#6366f1`), usando a fonte de sistema da Apple/Windows. 

Isso causa um rompimento severo de branding quando o usuário usa o frontend Sanfran e depois olha para o widget do agente.

### O que vamos alterar?

**1. CSS Global (`mcp-app.css` e `skill-display.css`)**
Vamos substituir o bloco atual do `:root` para mapear os tokens originais da UI do MCP para a paleta "Café":
- O fundo geral passará a ser claro (`#F9F7F5`), alterando toda a estética para Light Mode por padrão (como o frontend).
- A fonte padrão deixará de ser a do sistema para se tornar a `Poppins`, e os blocos técnicos usarão `JetBrains Mono`.
- Os botões (Add, Configure) usarão a cor Primária (`#5D4432`) e o hover mudará para `#4D3728`.
- Os "Cards" (arquivos e diretórios mostrados no MCP) terão fundo `#F5F1EC` e bordas arredondadas de `8px`.
- Atualizaremos os "Badges" (Local, GitHub, etc.) para usarem as cores secundárias e de accent do Café, abandonando os tons chamativos originais de neon.

**2. HTML (`mcp-app.html` e `skill-display.html`)**
- Importaremos a tag do Google Fonts com `Poppins` e `JetBrains Mono` no `<head>` dos arquivos HTML do MCP para garantir a consistência tipográfica sem que o cliente do Agente (ex: Claude) as bloqueie.

## Análise de Conteúdo e Identidade Visual (Remoção do Skilljack)

A interface atual foi projetada de forma genérica (herdada do projeto original "Skilljack") e não reflete a identidade e o propósito da plataforma Sanfran.md.

### 1. Conteúdo Escrito e Nomenclaturas
- **Títulos Genéricos:** Atualmente usa `<h1>Skills Directories</h1>` e `<h1>Available Skills</h1>`. Isso não passa a identidade da marca.
  - **Proposta:** Mudar para cabeçalhos com branding forte, introduzindo o nome da plataforma e o contexto. Exemplo: substituir para `Sanfran.md - Gestão de Skills Jurídicas`.
- **Banners e Dicas em Inglês:** Dicas como `"Tip: Ask Claude to 'show my skills'..."` estão em inglês e com tom estritamente técnico.
  - **Proposta:** Traduzir e humanizar o texto para o tom do Sanfran (ex: `"Dica: Peça ao agente para 'mostrar minhas skills' para visualizar o catálogo jurídico."`).
- **Nomenclaturas Técnicas (Skilljack):** Termos muito ligados ao funcionamento interno da engine (ex: "Well-Known Allowed Origins", "Static Mode") intimidam usuários comuns.
  - **Proposta:** Renomear as seções para termos mais amigáveis ao usuário final, como "Origens Confiáveis (URLs)" e "Repositórios Seguros", além de traduzir os textos das modais de configuração.

### 2. Organização do Layout e Branding (Sanfran.md Logo)
- **Falta de Logo e Avatar:** A interface atualmente consiste apenas de texto em listagens secas. O usuário que está conversando com a IA não tem o reforço visual de onde essas "skills" vêm.
  - **Proposta:** Adicionar o logo do Sanfran.md no cabeçalho das telas `mcp-app.html` e `skill-display.html`. Uma imagem de cabeçalho ou o logotipo oficial reforçará imediatamente a marca quando a interface abrir dentro do agente (como no Claude).
- **Hierarquia Visual:** O layout atual é focado na parte técnica de servidores e caminhos (directory paths).
  - **Proposta:** Dar foco às **Skills** em si. Ajustar a estrutura das listas para se parecerem mais com "Cards" do Marketplace (mesmo conceito do frontend Web). Configurações avançadas e listas de "Orgs Permitidas" podem receber menos peso visual em relação à listagem das ferramentas conectadas.

## User Review Required
> [!IMPORTANT]
> A proposta completa acima não apenas muda as cores (para o Café), mas **re-escreve os textos e adiciona o branding (logo/nomes)** do Sanfran, limpando a herança técnica do Skilljack.
> Você aprova que os textos sejam traduzidos e o logo do Sanfran.md seja incluído no cabeçalho da UI do MCP?

Se aprovado, seguirei com as edições nos arquivos HTML e CSS do MCP para refletir a nova identidade visual completa.

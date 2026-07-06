# Cores e Variáveis de Estilo

# Arquivos de Variáveis

Abaixo segue referencia para criação de arquivos scss com as principais variáveis utilizadas para o projeto.

- _variables.scss
    
    ```scss
    // ===========================================
    // COLORS - BASE
    // ===========================================
    
    $color-white: #FFFFFF;
    $color-black: #131313;
    
    // ===========================================
    // COLORS - GRAY
    // ===========================================
    
    $color-gray-50: #F5F7FA;
    $color-gray-100: #EBEEF3;
    $color-gray-200: #D2DAE5;
    $color-gray-300: #ABBCCE;
    $color-gray-400: #7E98B2;
    $color-gray-500: #5D7B9A;
    $color-gray-600: #496280;
    $color-gray-700: #3C5068;
    $color-gray-800: #354557;
    $color-gray-900: #303C4A;
    $color-gray-950: #27303D;
    
    // ===========================================
    // COLORS - ORANGE (Brand)
    // ===========================================
    
    $color-orange-50: #FFF7EC;
    $color-orange-100: #FFEDD3;
    $color-orange-200: #FFD7A5;
    $color-orange-300: #FFBA6D;
    $color-orange-400: #FF9132;
    $color-orange-500: #FF710A;
    $color-orange-600: #FF5700;
    $color-orange-700: #FF4400;
    $color-orange-800: #FC3200;
    
    // ===========================================
    // COLORS - BLUE
    // ===========================================
    
    $color-blue-50: #EEF7FF;
    $color-blue-100: #D9ECFF;
    $color-blue-200: #BBDEFF;
    $color-blue-400: #56ACFF;
    $color-blue-500: #2F89FF;
    $color-blue-600: #1869F8;
    $color-blue-700: #1152E4;
    $color-blue-800: #1543B8;
    $color-blue-900: #173D91;
    $color-blue-950: #11224E;
    
    // ===========================================
    // COLORS - RED (Warn)
    // ===========================================
    
    $color-red-100: #FFDCDC;
    $color-red-300: #FF9292;
    $color-red-700: #DB0000;
    $color-red-800: #B50000;
    $color-red-900: #940808;
    
    // ===========================================
    // COLORS - YELLOW (Warn)
    // ===========================================
    
    $color-yellow-100: #FFF5C5;
    $color-yellow-300: #FFDA46;
    $color-yellow-400: #FFC71B;
    $color-yellow-500: #FFA500;
    $color-yellow-600: #E27C00;
    
    // ===========================================
    // COLORS - GREEN
    // ===========================================
    
    $color-green-50: #EAFFF6;
    $color-green-100: #CDFEE8;
    $color-green-300: #63F2C1;
    $color-green-500: #01C38D;
    $color-green-700: #008262;
    $color-green-900: #005442;
    $color-green-950: #003027;
    
    // ===========================================
    // SEMANTIC COLORS
    // ===========================================
    
    $color-primary: $color-orange-500;
    $color-primary-dark: $color-orange-600;
    $color-primary-light: $color-orange-400;
    
    $color-success: $color-green-500;
    $color-error: $color-red-700;
    $color-warning: $color-yellow-500;
    $color-info: $color-blue-500;
    
    // ===========================================
    // TYPOGRAPHY
    // ===========================================
    
    $font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    
    $font-size-5xs: 0.5rem;      // 8px
    $font-size-4xs: 0.5625rem;   // 9px
    $font-size-3xs: 0.625rem;    // 10px
    $font-size-2xs: 0.6875rem;   // 11px
    $font-size-xs: 0.75rem;      // 12px
    $font-size-sm: 0.875rem;     // 14px
    $font-size-md: 1rem;         // 16px
    $font-size-lg: 1.125rem;     // 18px
    $font-size-xl: 1.25rem;      // 20px
    $font-size-2xl: 1.375rem;    // 22px
    $font-size-3xl: 1.5625rem;   // 25px
    $font-size-4xl: 1.75rem;     // 28px
    $font-size-5xl: 2rem;        // 32px
    $font-size-6xl: 2.25rem;     // 36px
    
    $font-weight-normal: 400;
    $font-weight-medium: 500;
    $font-weight-semibold: 600;
    $font-weight-bold: 700;
    
    $line-height-tight: 1.25;
    $line-height-base: 1.5;
    $line-height-relaxed: 1.75;
    
    // ===========================================
    // SPACING
    // ===========================================
    
    $spacing-xs: 0.25rem;   // 4px
    $spacing-sm: 0.5rem;    // 8px
    $spacing-md: 1rem;      // 16px
    $spacing-lg: 1.5rem;    // 24px
    $spacing-xl: 2rem;      // 32px
    $spacing-2xl: 2.5rem;   // 40px
    
    // ===========================================
    // BREAKPOINTS
    // ===========================================
    
    $breakpoint-sm: 640px;
    $breakpoint-md: 768px;
    $breakpoint-lg: 1024px;
    $breakpoint-xl: 1280px;
    $breakpoint-2xl: 1536px;
    
    // ===========================================
    // BORDERS & RADIUS
    // ===========================================
    
    $border-radius-xs: 5px;
    $border-radius-sm: 10px;
    $border-radius-md: 15px;
    $border-radius-lg: 20px;
    $border-radius-full: 9999px;
    
    // ===========================================
    // SHADOWS
    // ===========================================
    
    $shadow-100: 0 2px 4px -2px rgba(24, 39, 75, 0.12), 0 4px 4px -2px rgba(24, 39, 75, 0.08);
    $shadow-200: 0 4px 6px -4px rgba(24, 39, 75, 0.12), 0 8px 8px -4px rgba(24, 39, 75, 0.08);
    $shadow-300: 0 6px 8px -6px rgba(24, 39, 75, 0.12), 0 8px 16px -6px rgba(24, 39, 75, 0.08);
    $shadow-400: 0 6px 12px -6px rgba(24, 39, 75, 0.12), 0 8px 24px -4px rgba(24, 39, 75, 0.08);
    $shadow-500: 0 6px 14px -6px rgba(24, 39, 75, 0.12), 0 10px 32px -4px rgba(24, 39, 75, 0.10);
    $shadow-600: 0 8px 18px -6px rgba(24, 39, 75, 0.12), 0 12px 42px -4px rgba(24, 39, 75, 0.12);
    $shadow-700: 0 8px 22px -6px rgba(24, 39, 75, 0.12), 0 14px 64px -4px rgba(24, 39, 75, 0.12);
    $shadow-800: 0 8px 28px -6px rgba(24, 39, 75, 0.12), 0 18px 88px -4px rgba(24, 39, 75, 0.14);
    
    // ===========================================
    // Z-INDEX
    // ===========================================
    
    $z-index-dropdown: 100;
    $z-index-sticky: 200;
    $z-index-fixed: 300;
    $z-index-modal-backdrop: 400;
    $z-index-modal: 500;
    $z-index-tooltip: 600;
    ```
    

- _mixins.scss
    
    ```scss
    // ===========================================
    // BREAKPOINT MIXINS
    // ===========================================
    
    @mixin sm {
      @media (min-width: $breakpoint-sm) {
        @content;
      }
    }
    
    @mixin md {
      @media (min-width: $breakpoint-md) {
        @content;
      }
    }
    
    @mixin lg {
      @media (min-width: $breakpoint-lg) {
        @content;
      }
    }
    
    @mixin xl {
      @media (min-width: $breakpoint-xl) {
        @content;
      }
    }
    
    @mixin xxl {
      @media (min-width: $breakpoint-2xl) {
        @content;
      }
    }
    ```
    

# Princípios de Uso

A paleta da Mais Chat prioriza neutralidade e legibilidade. Embora o laranja seja nossa cor de marca, ele deve ser usado estrategicamente como destaque, não como cor dominante da interface.

**Hierarquia cromática:**

1. **Cinza** (gray-*) - Base estrutural da plataforma
2. **Azul** (blue-*) - Ações secundárias e informações
3. **Laranja** (orange-*) - Destaques pontuais e identidade

# Cinza (Base Estrutural)

Os tons de cinza formam a espinha dorsal visual da plataforma e devem representar 70-80% das cores visíveis na interface.

**Quando usar:**

- Ações primárias: botões principais usam `gray-800`
- Textos: `gray-900` para corpo, `gray-600` para secundários
- Backgrounds: `gray-50` para fundos suaves, `gray-100` para cards
- Bordas e divisores: `gray-100` ou `gray-200`

**Por quê cinza para ações primárias:**
Diferente de plataformas mais "empolgantes", uma ferramenta de CRM precisa transmitir profissionalismo e confiabilidade. Botões em cinza escuro reduzem fadiga visual e permitem que elementos de destaque (alertas, notificações) ganhem a atenção necessária.

# **Laranja (Acento de Marca)**

⚠️ **Uso restrito e intencional**

O laranja é nossa cor de marca, mas seu uso excessivo na interface pode:

- Infantilizar a interface
- Criar sensação de alerta constante
- Causar fadiga visual
- Reduzir a eficácia quando realmente precisarmos chamar atenção

**Quando usar:**

- Logo e elementos de identidade
- Estados ativos/selecionados (ex: item selecionado em menu lateral)
- Avatares sem foto (backgrounds de iniciais)
- Destaques pontuais em textos (links importantes, valores-chave)
- Indicadores de status específicos (ex: "aguardando resposta")

**Limite sugerido:** Não mais que 5-10% da área visível de uma tela.

**Evitar:**

- ❌ Botões primários de ação
- ❌ Fundos grandes ou backgrounds de seções
- ❌ Todos os ícones ou badges
- ❌ Bordas de inputs em foco

## Distinção: CTA de marketing vs CTA da plataforma

O laranja pode aparecer em botões **apenas quando o contexto é de marketing/upsell** dentro da plataforma — nunca em ações funcionais do produto.

| Contexto | Laranja? | Exemplo |
| --- | --- | --- |
| Empty state de módulo não contratado | ✅ Sim | "Conhecer o Pushy", "Ativar mVoice" |
| Banner promocional / upgrade de plano | ✅ Sim | Upsell dentro da plataforma |
| Ação primária de funcionalidade | ❌ Não | "Salvar", "Criar", "Enviar" |
| Ação secundária | ❌ Não | "Cancelar", "Voltar" |

**Como diferenciar:** Se o botão executa uma ação do produto (salvar dados, criar registro, enviar mensagem), ele é cinza (`gray-800`). Se o botão convida o usuário a conhecer/contratar algo novo, ele pode ser laranja.

# **Azul (Ações Secundárias)**

O azul transmite confiança e tecnologia, sendo ideal para ações secundárias e elementos informativos.

**Quando usar:**

- Botões secundários e terciários
- Links de navegação
- Estados de informação (`info`)
- Elementos interativos de menor hierarquia

# **Cores Semânticas**

Use exclusivamente para seus respectivos contextos - nunca por preferência estética.

**Success (Verde):**

- Confirmações de ações concluídas
- Estados positivos (mensagem enviada, sincronização ok)
- Indicadores de disponibilidade/online

**Error (Vermelho):**

- Mensagens de erro
- Validações de formulário
- Ações destrutivas (deletar, remover)

**Warning (Amarelo/Laranja):**

- Alertas que exigem atenção mas não bloqueiam
- Limites próximos de serem atingidos
- Ações que precisam de confirmação

**Info (Azul):**

- Mensagens informativas
- Dicas e orientações ao usuário

# **Regras de Contraste**

- Textos sobre `gray-50/100`: usar `gray-900` ou `gray-800`
- Textos sobre cores escuras (`gray-800/900`): usar `white`
- Textos sobre backgrounds coloridos: garantir ratio WCAG AA mínimo (4.5:1)
<script>
  import { onMount } from "svelte";
  let isLogin = true;

  let email = "";
  let password = "";
  let name = "";
  let username = "";
  const usernamePattern = "[a-z0-9][a-z0-9-]{1,61}[a-z0-9]";

  // Variáveis auxiliares para controle de estado da requisição
  let loading = false;
  let errorMessage = "";
  let continueTo = null;
  let appFlow = null;
  let emailVerificationPending = false;
  let verificationCode = "";
  // O formulário só pode aparecer depois de confirmar que não há sessão. Sem
  // isso, uma sessão já válida deixa a tela de login visível por alguns frames
  // antes do redirect começar.
  // sessionCheck: 'checking' | 'authenticated' | 'ready' | 'failed'
  // 'authenticated' é a sessão já confirmada cuja instância ainda está sendo
  // consultada; também não pode liberar o formulário.
  let sessionCheck = "checking";
  let sessionCheckError = "";
  let initialSetupRequired = false;
  let registrationEnabled = true;
  let invitationsEnabled = true;
  let invitationCode = "";

  function continueTarget() {
    const query = new URLSearchParams(window.location.search);
    if (query.get("flow") === "app" && query.get("app") === "lectio") {
      appFlow = "lectio";
      return "/auth/apps/lectio/enter";
    }
    const next = query.get("next");
    if (!next?.startsWith("/") || next.startsWith("//") || next.includes("\\")) return null;

    const path = next.split(/[?#]/, 1)[0];
    if (
      path === "/view/auth/Login" ||
      path === "/auth/google/start" ||
      path === "/auth/google/callback" ||
      path === "/auth/ticket"
    ) return null;

    return next;
  }

  // --- LOGIN COM GOOGLE ---
  //
  // O callback do OAuth não tem como renderizar mensagem: ele redireciona de
  // volta pra cá com ?erro=<código>. Traduzimos aqui.
  const ERROS_GOOGLE = {
    "google-nao-configurado": "Login com Google não está configurado neste servidor.",
    "google-cancelado": "Login com Google cancelado.",
    "google-resposta-incompleta": "O Google devolveu uma resposta incompleta. Tente de novo.",
    "google-estado-invalido": "Sessão de login expirada ou inválida. Tente de novo.",
    "google-estado-expirado": "A tentativa de login demorou demais. Tente de novo.",
    "google-troca-falhou": "Não foi possível concluir o login com o Google.",
    "google-indisponivel": "O Google não respondeu. Tente de novo em instantes.",
    "google-token-invalido": "Não foi possível validar sua conta Google.",
    "app-invalido": "Este aplicativo não está disponível para cadastro público.",
    "google-sem-conta":
      "Nenhuma conta ThinkIac usa esse e-mail do Google. O cadastro é por convite — crie a conta primeiro e depois entre com o Google.",
    "google-registration-disabled":
      "Google sign-in is available only for existing accounts while registration or invitations are restricted.",
    "ticket-ausente": "Link de acesso incompleto.",
    "ticket-invalido": "Link de acesso inválido.",
    "ticket-reusado": "Este link de acesso já foi usado.",
    "ticket-expirado": "Este link de acesso expirou. Entre de novo.",
    "ticket-orfao": "A conta associada a este acesso não existe mais.",
  };

  // client=android muda o final do fluxo: em vez de gravar o cookie, o
  // callback devolve um ticket por deep link, porque a Custom Tab onde o
  // consentimento roda não compartilha cookie jar com esta WebView. O app
  // Flutter injeta __thinkiacAppId em toda página que carrega (ver
  // apps/mobile/lib/main.dart), e é esse o sinal de que estamos dentro dele.
  let googleHref = "/auth/google/start?client=web";

  // O desktop (apps/desktop, Electron) precisa do mesmo tratamento do Android
  // e pelo mesmo motivo: o consentimento abre no navegador do sistema, cujo
  // cookie jar não é o da janela do app. O Electron carimba "Electron/<versão>"
  // no user agent, e é só isso que temos aqui — o preload não expõe flag.
  function clienteAtual() {
    const dentroDoAppMobile =
      !!window.__thinkiacAppId ||
      (() => {
        try {
          return !!window.localStorage.getItem("thinkiac_app_id");
        } catch {
          return false;
        }
      })();
    // A checagem do Electron vem primeiro: o desktop também guarda
    // thinkiac_app_id, então a ordem inversa o classificaria como android.
    if (/electron/i.test(navigator.userAgent)) return "electron";
    if (dentroDoAppMobile) return "android";
    return "web";
  }

  function montarGoogleHref() {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams({ client: clienteAtual() });
    // O backend revalida, mas não faz sentido mandar um destino que ele vai
    // descartar. Usa a mesma decisão do login por senha e da sessão existente.
    if (continueTo) params.set("next", continueTo);
    if (appFlow) {
      params.set("flow", "app");
      params.set("app", appFlow);
    }
    googleHref = `/auth/google/start?${params}`;
  }

  // Estado de espera pela provisão (depois de cadastro/login sem ssoUrl
  // ainda — instância pessoal ainda não terminou de subir).
  // tenantStatus: null | 'pending' | 'warming' | 'ready' | 'failed'
  //   'pending' — container/domínio/certificado sendo criados.
  //   'warming' — container no ar, mas a página de destino ainda não
  //               renderizou uma vez sequer nesse processo (build sob
  //               demanda) — o backend fica chamando até ela responder.
  //   'ready'   — o gateway terminou o provisionamento; antes de navegar, a
  //               própria tela toca o destino SSO até a primeira resposta 2xx.
  let tenantStatus = null;
  let provisioningFailed = false;
  let ssoUrl = null;
  let destinationPolling = false;
  let isMounted = true;
  const DESTINATION_WARMUP_BUDGET_MS = 6000;

  const STEPS = [
    { key: "pending", label: "Provisionando sua instância" },
    { key: "warming", label: "Preparando seu workspace" },
  ];
  const STEP_ORDER = ["pending", "warming", "ready"];

  // ── Onboarding Parte 1 — preenchido durante pending/warming ──────────────
  // A Parte 2 (tom + instruções) só acontece dentro do tenant, na primeira
  // conversa com o Agent — ver apps/thinkiac/packages/agent/hooks/onboarding.js.
  let onboardingStep = 0;
  let onboardingDone = false;
  let purpose = "";
  let briefContext = "";
  let audience = "";

  const PURPOSE_SUGGESTIONS = [
    "Responder clientes mais rápido",
    "Organizar tarefas do dia a dia",
    "Analisar dados e planilhas",
    "Escrever e revisar textos",
    "Automatizar processos repetitivos",
  ];
  const AUDIENCE_SUGGESTIONS = ["Só eu", "Meus clientes", "Minha equipe"];

  // Brief rápido: tudo é opcional e ocupa o tempo em que a instância sobe,
  // sem criar uma etapa obrigatória antes do primeiro acesso.
  const ONBOARDING_STEP_COUNT = 3;

  // Salva incrementalmente — se a instância ficar pronta antes do usuário
  // terminar, o que já foi respondido não se perde (a Parte 2 completa com o
  // resto depois, dentro do tenant).
  async function saveOnboarding(patch) {
    try {
      await fetch("/auth/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } catch (e) {
      // best-effort — não bloqueia o fluxo de provisionamento por causa disso
    }
  }

  // Terminou o onboarding e a instância já ficou pronta enquanto ele
  // respondia: entra agora, sem exigir mais um clique.
  async function finishOnboarding() {
    onboardingDone = true;
    if (ssoUrl) await pollDestinationUntilReady();
  }

  async function nextOnboardingStep(patch) {
    // Só avança depois que a tentativa de persistência terminou. Assim, um
    // tenant que ficou pronto muito rápido não redireciona no meio do save.
    if (patch) await saveOnboarding(patch);
    if (onboardingStep < ONBOARDING_STEP_COUNT - 1) {
      onboardingStep += 1;
    } else {
      await finishOnboarding();
    }
  }

  async function skipOnboarding() {
    await finishOnboarding();
  }

  function stepState(stepKey, current) {
    if (STEP_ORDER.indexOf(current) > STEP_ORDER.indexOf(stepKey)) return "done";
    if (current === stepKey) return "active";
    return "upcoming";
  }

  async function pollUntilReady() {
    provisioningFailed = false;
    errorMessage = "";
    if (!tenantStatus) tenantStatus = "pending";

    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 3000));

      let data;
      try {
        const res = await fetch("/auth/status");
        data = await res.json();
      } catch (e) {
        continue; // rede falhou nessa tentativa — tenta de novo no próximo tick
      }

      tenantStatus = data.tenantStatus;

      if (data.tenantStatus === "ready" && data.ssoUrl) {
        ssoUrl = data.ssoUrl;
        // Entra sozinho: criar conta e chegar no workspace é um movimento só.
        // A única espera é o onboarding em andamento — arrancar o usuário do
        // meio de uma resposta perderia o que ele estava digitando; nesse caso
        // a primeira request ao destino sai quando ele termina.
        if (onboardingDone) pollDestinationUntilReady();
        return;
      }
      if (data.tenantStatus === "failed") {
        provisioningFailed = true;
        errorMessage = data.failureReason || "Falha ao provisionar sua instância.";
        return;
      }
      // ainda "pending" ou "warming" — continua esperando
    }
  }

  async function pollDestinationUntilReady() {
    if (destinationPolling || !ssoUrl) return;
    destinationPolling = true;

    // Dá ao cache uma janela curta, mas nunca prende a entrada por causa dele.
    // Ao esgotar o orçamento, /auth/enter acorda o tenant e emite SSO novo;
    // a primeira renderização pode ser lenta, porém o usuário segue adiante.
    const deadline = Date.now() + DESTINATION_WARMUP_BUDGET_MS;
    while (isMounted && Date.now() < deadline) {
      try {
        const response = await fetch("/auth/destination-ready");
        const result = await response.json();
        if (!response.ok || !result.ready) {
          throw new Error("Workspace ainda não está disponível.");
        }
        // /auth/enter emite um ticket novo para a navegação final. A view já
        // foi aquecida pela request acima, portanto a segunda carga vem do
        // cache do tenant em vez de pagar o primeiro build ao usuário.
        window.location.assign("/auth/enter");
        return;
      } catch (error) {
        // Falhas de rede ou uma resposta 502 do proxy mantêm a pessoa nesta
        // tela e acionam uma nova tentativa, sem expor a página de erro.
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    if (isMounted) window.location.assign("/auth/enter");
    destinationPolling = false;
  }

  async function retryProvisioning() {
    errorMessage = "";
    try {
      const res = await fetch("/auth/retry-provisioning", { method: "POST" });
      const data = await res.json();
      if (data.status !== 200) {
        errorMessage = data.message || "Falha ao tentar novamente.";
        return;
      }
      pollUntilReady();
    } catch (e) {
      errorMessage = "Falha de conexão com o servidor.";
    }
  }

  async function handleAuthSubmit(event) {
    errorMessage = "";

    // Password managers can populate the visible controls without emitting the
    // input events used by bind:value. Read the submitted DOM values so the
    // request always reflects what the person sees in the form.
    const formData = new FormData(event.currentTarget);
    const submittedEmail = String(formData.get("email") || "").trim();
    const submittedPassword = String(formData.get("password") || "");
    const submittedName = String(formData.get("name") || "").trim();
    const submittedUsername = String(formData.get("username") || "").trim();
    const submittedInvitationCode = String(formData.get("invitationCode") || "").trim();

    if (!submittedEmail || !submittedPassword) {
      errorMessage = "Preencha o e-mail e a senha.";
      return;
    }
    if (!isLogin && (!submittedName || !submittedUsername)) {
      errorMessage = "Preencha o nome e o username.";
      return;
    }
    if (!isLogin && !registrationEnabled && invitationsEnabled && !submittedInvitationCode) {
      errorMessage = "Enter a valid invitation code.";
      return;
    }

    email = submittedEmail;
    password = submittedPassword;
    name = submittedName;
    username = submittedUsername;
    invitationCode = submittedInvitationCode;
    loading = true;

    // Define o endpoint correto baseado no estado atual (Login ou Cadastro)
    // Se a API de cadastro for diferente, altere a URL do 'register'
    const url = initialSetupRequired
      ? "/auth/initial-admin"
      : isLogin
        ? "/auth/login"
        : "/auth/register";

    // Monta o corpo da requisição dependendo da tela
    const bodyData = isLogin
      ? { email: submittedEmail, password: submittedPassword }
      : {
          name: submittedName,
          email: submittedEmail,
          username: submittedUsername,
          password: submittedPassword,
          ...(submittedInvitationCode ? { invitationCode: submittedInvitationCode } : {}),
          ...(appFlow ? { flow: "app", app: appFlow } : {}),
        };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(bodyData),
      });

      const result = await response.json();

      // login() sempre responde HTTP 200 (erro vem em result.error); register()
      // usa res.status(400) de verdade nos erros — checa os dois casos.
      if (result.error || !response.ok) {
        if (result.requiresEmailVerification) emailVerificationPending = true;
        throw new Error(result.error || result.message || "Ocorreu um erro na requisição.");
      }

      if (result.requiresEmailVerification) {
        emailVerificationPending = true;
        return;
      }

      if (continueTo) {
        window.location.href = continueTo;
        return;
      }

      window.location.href = result.redirectUrl || "/redirect/home";
    } catch (error) {
      console.error("Erro na autenticação:", error);
      errorMessage = error.message;
    } finally {
      loading = false;
    }
  }

  async function resendVerification() {
    loading = true;
    errorMessage = "";
    try {
      const response = await fetch("/auth/resend-verification", { method: "POST" });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error || "Falha ao reenviar.");
      errorMessage = "Enviamos um novo código para seu e-mail.";
    } catch (error) { errorMessage = error.message; }
    finally { loading = false; }
  }

  async function confirmEmailCode() {
    loading = true;
    errorMessage = "";
    try {
      const response = await fetch("/auth/confirm-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: verificationCode.replace(/\s/g, "") }),
      });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error || "Não foi possível confirmar seu e-mail.");
      emailVerificationPending = false;
      window.location.href = result.redirectUrl || "/redirect/home";
    } catch (error) {
      errorMessage = error.message;
    } finally {
      loading = false;
    }
  }

  async function checkExistingSession() {
    sessionCheck = "checking";
    sessionCheckError = "";

    // Se já tem sessão válida, não faz sentido mostrar o formulário de novo.
    let result;
    try {
      const response = await fetch("/auth/get", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      result = await response.json();

      // 401 é a resposta normal para visitante; qualquer outro erro impede
      // concluir com segurança que a pessoa está deslogada.
      if (!response.ok && response.status !== 401) {
        throw new Error(result?.message || "Não foi possível verificar sua sessão.");
      }
    } catch (error) {
      sessionCheck = "failed";
      sessionCheckError =
        error.message || "Falha de conexão ao verificar sua sessão.";
      return;
    }

    if (!result?.id) {
      try {
        const response = await fetch("/auth/initial-setup");
        const setup = await response.json();
        if (!response.ok) throw new Error(setup?.error || "Unable to check initial setup.");
        initialSetupRequired = setup.initialSetupRequired === true;
        registrationEnabled = setup.settings?.registrationEnabled !== false;
        invitationsEnabled = setup.settings?.invitationsEnabled !== false;
        if (initialSetupRequired) isLogin = false;
      } catch (error) {
        sessionCheck = "failed";
        sessionCheckError = error.message || "Unable to check initial setup.";
        return;
      }
      sessionCheck = "ready";
      return;
    }

    if (new URLSearchParams(window.location.search).get("verify-email") === "1" && !result.emailVerified) {
      email = result.email;
      emailVerificationPending = true;
      sessionCheck = "ready";
      return;
    }

    if (continueTo) {
      window.location.href = continueTo;
      return;
    }
    window.location.href = result.redirectUrl || "/redirect/home";
  }

  onMount(() => {
    continueTo = continueTarget();
    montarGoogleHref();

    // ?erro=<código> vem do redirect do /auth/google/callback ou /auth/ticket.
    const erro = new URLSearchParams(window.location.search).get("erro");
    if (erro) {
      errorMessage = ERROS_GOOGLE[erro] || "Não foi possível entrar. Tente de novo.";
      // Tira da barra de endereços para o erro não reaparecer num refresh.
      const limpa = new URL(window.location.href);
      limpa.searchParams.delete("erro");
      window.history.replaceState({}, "", limpa);
    }

    checkExistingSession();

    return () => {
      isMounted = false;
    };
  });
</script>

<div class="page">
  <div class="ambient"></div>

  <div class="auth-shell">
    {#if sessionCheck === "checking"}
      <div class="brand" aria-live="polite">
        <div class="brand-mark spinning"></div>
        <div class="brand-copy">
          <h1>Checking your session</h1>
          <p>Just a moment.</p>
        </div>
      </div>
    {:else if sessionCheck === "failed"}
      <div class="brand" role="alert">
        <div class="brand-mark"></div>
        <div class="brand-copy">
          <h1>We couldn't verify your session</h1>
          <p>{sessionCheckError}</p>
        </div>
      </div>
      <button class="submit" on:click={checkExistingSession}>Try again</button>
    {:else if tenantStatus && !provisioningFailed}
      <div class="brand">
        <div class:spinning={tenantStatus !== "ready" || !onboardingDone} class="brand-mark"></div>
        <div class="brand-copy">
          {#if tenantStatus === "ready" && onboardingDone}
            <h1>Seu espaço está pronto</h1>
            <p>Validando o acesso seguro. Você será redirecionado em instantes.</p>
          {:else}
            <h1>Preparando seu espaço</h1>
            <p>Enquanto isso, conte um pouco sobre o que quer construir.</p>
          {/if}
        </div>
      </div>
      {#if tenantStatus === "ready" && onboardingDone}
        <div class="redirect-progress" aria-live="polite" aria-busy="true"><span></span></div>
      {:else}
        <ul class="step-list">
          {#each STEPS as step}
            <li class="step step-{stepState(step.key, tenantStatus)}">
              <span class="step-dot"></span>
              <span class="step-label">{step.label}</span>
            </li>
          {/each}
        </ul>
      {/if}

      {#if !onboardingDone}
        <div class="onboarding">
          <p class="onboarding-hint">
            Brief rápido e opcional. Assim o Agent já entra entendendo o que
            importa para você.
          </p>

          {#if onboardingStep === 0}
            <div class="field">
              <label>Qual resultado você quer alcançar primeiro?</label>
              <div class="chip-row">
                {#each PURPOSE_SUGGESTIONS as suggestion}
                  <button
                    type="button"
                    class="chip"
                    class:active={purpose === suggestion}
                    on:click={() => (purpose = suggestion)}
                  >
                    {suggestion}
                  </button>
                {/each}
              </div>
              <input
                bind:value={purpose}
                type="text"
                placeholder="Ou escreva uma ideia solta — não precisa estar definida"
              />
            </div>
            <div class="onboarding-actions">
              <button type="button" class="link-btn" on:click={skipOnboarding}>
                Pular brief
              </button>
              <button
                type="button"
                class="submit"
                on:click={() =>
                  nextOnboardingStep(
                    purpose.trim() ? { purpose } : null,
                  )}
              >
                Continuar
            </div>
          {:else if onboardingStep === 1}
            <div class="field">
              <label>Qual é o contexto desse começo?</label>
              <p class="field-hint">Opcional: seu negócio, trabalho, projeto ou rotina.</p>
              <div class="chip-row">
                <button
                  type="button"
                  class="chip"
                  class:active={briefContext === "Meu negócio ou trabalho"}
                  on:click={() => (briefContext = "Meu negócio ou trabalho")}
                >
                  Meu negócio ou trabalho
                </button>
                <button
                  type="button"
                  class="chip"
                  class:active={briefContext === "Uma ideia ou projeto"}
                  on:click={() => (briefContext = "Uma ideia ou projeto")}
                >
                  Uma ideia ou projeto
                </button>
                <button
                  type="button"
                  class="chip"
                  class:active={briefContext === "Minha rotina pessoal"}
                  on:click={() => (briefContext = "Minha rotina pessoal")}
                >
                  Minha rotina pessoal
                </button>
              </div>
              <input
                bind:value={briefContext}
                type="text"
                placeholder="Ex.: uma clínica, uma loja, estudos, um lançamento..."
              />
            </div>
            <div class="onboarding-actions">
              <button
                type="button"
                class="link-btn"
                on:click={skipOnboarding}>Pular brief</button
              >
              <button
                type="button"
                class="submit"
                on:click={() =>
                  nextOnboardingStep({
                    ...(briefContext.trim() ? { briefContext } : {}),
                  })}
              >
                Continuar
              </button>
            </div>
          {:else if onboardingStep === 2}
            <div class="field">
              <label>Para quem você quer criar isso?</label>
              <p class="field-hint">Opcional. Ajuda o Agent a ajustar linguagem e prioridades.</p>
              <div class="chip-row">
                {#each AUDIENCE_SUGGESTIONS as suggestion}
                  <button
                    type="button"
                    class="chip"
                    class:active={audience === suggestion}
                    on:click={() => (audience = suggestion)}
                  >
                    {suggestion}
                  </button>
                {/each}
              </div>
            </div>
            <div class="onboarding-actions">
              <button
                type="button"
                class="link-btn"
                on:click={skipOnboarding}>Pular brief</button
              >
              <button
                type="button"
                class="submit"
                on:click={() =>
                  nextOnboardingStep({
                    ...(purpose.trim() ? { purpose } : {}),
                    ...(audience.trim() ? { audience } : {}),
                  })}
              >
                Concluir
              </button>
            </div>
          {/if}
        </div>
      {/if}
    {:else if provisioningFailed}
      <div class="brand">
        <div class="brand-mark"></div>
        <div class="brand-copy">
          <h1>Something went wrong</h1>
          <p>{errorMessage}</p>
        </div>
      </div>
      <button class="submit" on:click={retryProvisioning}>Try again</button>
    {:else if emailVerificationPending}
      <div class="brand">
        <div class="brand-mark"></div>
        <div class="brand-copy">
          <h1>Confirme seu e-mail e receba US$ 5</h1>
          <p>Enviamos um link e um código de 8 dígitos para {email}.</p>
        </div>
      </div>
      <form class="card" on:submit|preventDefault={confirmEmailCode}>
        <div class="field">
          <label for="verification-code">Código de confirmação</label>
          <input id="verification-code" bind:value={verificationCode} inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{8}" maxlength="8" placeholder="12345678" required />
        </div>
        {#if errorMessage}<p class="form-error">{errorMessage}</p>{/if}
        <button class="submit" disabled={loading}>{loading ? "Confirmando..." : "Confirmar e-mail"}</button>
        <button type="button" class="link-btn" disabled={loading} on:click={resendVerification}>Reenviar código</button>
        <a class="link-btn" href="/auth/enter">Continuar usando meu ambiente</a>
        <button type="button" class="link-btn" on:click={() => { emailVerificationPending = false; errorMessage = ""; }}>Voltar</button>
      </form>
    {:else}
    <div class="brand">
      <div class="brand-mark"></div>

      <div class="brand-copy">
        <h1>
          {initialSetupRequired ? "Create the first administrator" : isLogin ? "Welcome back" : "Create account"}
        </h1>

        <p>
          {initialSetupRequired
            ? "Set up the account that will manage users and access."
            : isLogin
            ? "Access your workspace securely."
            : "Start building your intelligent workspace."}
        </p>
      </div>
    </div>

    <form class="card" novalidate on:submit|preventDefault={handleAuthSubmit}>
      {#if !isLogin}
        <div class="field">
          <label>Name</label>

          <input
            bind:value={name}
            name="name"
            type="text"
            placeholder="John Doe"
            required
          />
        </div>

        {#if !initialSetupRequired && invitationsEnabled}
          <div class="field">
            <label>Invitation code{registrationEnabled ? " (optional)" : ""}</label>
            <input bind:value={invitationCode} name="invitationCode" type="text" autocomplete="off" placeholder="XXXX-XXXX-XXXX" required={!registrationEnabled} />
          </div>
        {/if}

        <div class="field">
          <label>Username</label>

          <input
            bind:value={username}
            name="username"
            type="text"
            placeholder="seu-usuario"
            pattern={usernamePattern}
            title="minúsculas, números e hífen"
            required
          />
        </div>

      {/if}

      <div class="field">
        <label>Email</label>

        <input
          bind:value={email}
          name="email"
          type="email"
          autocomplete="email"
          placeholder="name@company.com"
          required
        />
      </div>

      <div class="field">
        <label>Password</label>

        <input
          bind:value={password}
          name="password"
          type="password"
          autocomplete={isLogin ? "current-password" : "new-password"}
          placeholder="••••••••"
          required
        />
      </div>

      {#if errorMessage}
        <p class="form-error">
          {errorMessage}
        </p>
      {/if}

      <button type="submit" class="submit" disabled={loading}>
        {loading ? "Loading..." : initialSetupRequired ? "Create administrator" : isLogin ? "Continue" : "Create account"}
      </button>

      {#if isLogin && !initialSetupRequired}
        <div class="divisor"><span>ou</span></div>

        <!-- Link, não fetch: precisa ser navegação top-level para o app
             Flutter conseguir interceptar em onNavigationRequest e abrir em
             Chrome Custom Tab. O Google recusa OAuth dentro de WebView
             embutida (403 disallowed_useragent), então este clique não pode
             virar XHR nem navegação dentro de iframe. -->
        <a class="google" href={googleHref} data-oauth="google">
          <svg viewBox="0 0 18 18" aria-hidden="true">
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/>
            <path fill="#FBBC05" d="M3.97 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3.01-2.33z"/>
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3.01 2.33C4.68 5.17 6.66 3.58 9 3.58z"/>
          </svg>
          Entrar com Google
        </a>
      {/if}
    </form>

    {#if !initialSetupRequired && (registrationEnabled || invitationsEnabled)}<div class="footer">
      <span>
        {isLogin ? "New here?" : "Already have an account?"}
      </span>

      <button type="button" on:click={() => (isLogin = !isLogin)}>
        {isLogin ? "Create account" : "Sign in"}
      </button>
    </div>
    {/if}
    {/if}
  </div>
</div>

<style>
  @import url('https://fonts.googleapis.com/css2?family=Ubuntu:ital,wght@0,300;0,400;0,500;0,700;1,400&family=Ubuntu+Mono:ital,wght@0,400;0,700;1,400&display=swap');

  :global(*) {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :global(body) {
    font-family: Ubuntu, system-ui, sans-serif;

    background: #0a0a0a;

    color: white;

    overflow-x: hidden;
  }

  :global(button),
  :global(input) {
    font: inherit;
  }

  .page {
    position: relative;

    width: 100%;
    min-height: 100dvh;

    display: flex;
    align-items: center;
    justify-content: center;

    background: radial-gradient(
        circle at top,
        rgba(255, 255, 255, 0.03),
        transparent 40%
      ),
      #0a0a0a;

    overflow-y: auto;
  }

  .ambient {
    position: absolute;
    inset: 0;

    background: radial-gradient(
        circle at 20% 20%,
        rgba(120, 119, 198, 0.1),
        transparent 25%
      ),
      radial-gradient(
        circle at 80% 30%,
        rgba(255, 255, 255, 0.04),
        transparent 30%
      );

    filter: blur(40px);

    opacity: 0.8;

    pointer-events: none;
  }

  .auth-shell {
    position: relative;
    z-index: 2;

    width: 100%;
    max-width: 420px;

    padding: 32px;
    margin: auto;
  }

  .brand {
    margin-bottom: 40px;
  }

  .brand-mark {
    width: 12px;
    height: 12px;

    border-radius: 999px;

    background: white;

    margin-bottom: 24px;

    box-shadow: 0 0 30px rgba(255, 255, 255, 0.15);
  }

  .brand-mark.spinning {
    animation: pulse 1.2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(0.7); }
  }

  .step-list {
    display: flex;
    flex-direction: column;
    gap: 14px;
    list-style: none;
    margin: 8px 0 32px;
  }

  .step {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 14px;
    color: rgba(255, 255, 255, 0.35);
    transition: color 0.2s ease;
  }

  .step-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.15);
    flex-shrink: 0;
    transition: background 0.2s ease, box-shadow 0.2s ease;
  }

  .step-active {
    color: rgba(255, 255, 255, 0.9);
  }

  .step-active .step-dot {
    background: white;
    box-shadow: 0 0 12px rgba(255, 255, 255, 0.4);
    animation: pulse 1.2s ease-in-out infinite;
  }

  .step-done {
    color: rgba(255, 255, 255, 0.55);
  }

  .step-done .step-dot {
    background: white;
    box-shadow: none;
  }

  .onboarding {
    display: flex;
    flex-direction: column;
    gap: 18px;

    padding-top: 24px;
    margin-top: 8px;

    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .onboarding-hint {
    font-size: 13px;
    line-height: 1.5;
    color: rgba(255, 255, 255, 0.4);
  }

  .onboarding .field input {
    height: 46px;
  }

  .chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .chip {
    padding: 8px 14px;

    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.03);

    color: rgba(255, 255, 255, 0.6);
    font-size: 13px;
    cursor: pointer;

    transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  }

  .chip:hover {
    background: rgba(255, 255, 255, 0.06);
    color: white;
  }

  .chip.active {
    background: white;
    border-color: white;
    color: black;
  }

  .onboarding-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 16px;
  }

  .onboarding-actions .submit {
    height: 42px;
    margin-top: 0;
    padding: 0 20px;
    flex: none;
  }

  .redirect-progress {
    height: 4px;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 999px;
  }

  .redirect-progress span {
    display: block;
    width: 42%;
    height: 100%;
    background: white;
    animation: redirect-progress 1.1s ease-in-out infinite;
  }

  @keyframes redirect-progress {
    from { transform: translateX(-110%); }
    to { transform: translateX(260%); }
  }

  .link-btn {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.4);
    font-size: 13px;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .link-btn:hover {
    color: rgba(255, 255, 255, 0.7);
  }

  .brand h1 {
    font-size: 34px;
    font-weight: 600;

    letter-spacing: -0.04em;

    margin-bottom: 10px;
  }

  .brand p {
    font-size: 15px;
    line-height: 1.6;

    color: rgba(255, 255, 255, 0.5);
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .form-error {
    color: var(--tk-text);
    font-size: 13px;
    text-align: center;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .field label {
    font-size: 13px;

    color: rgba(255, 255, 255, 0.5);
  }

  .field input {
    width: 100%;
    height: 52px;

    padding: 0 16px;

    border-radius: 14px;

    border: 1px solid rgba(255, 255, 255, 0.08);

    background: rgba(255, 255, 255, 0.03);

    color: white;

    outline: none;

    transition:
      border-color 0.2s ease,
      background 0.2s ease,
      transform 0.2s ease;
  }

  .field input::placeholder {
    color: rgba(255, 255, 255, 0.22);
  }

  .field input:hover {
    background: rgba(255, 255, 255, 0.045);
  }

  .field input:focus {
    border-color: rgba(255, 255, 255, 0.18);

    background: rgba(255, 255, 255, 0.05);
  }

  .submit {
    height: 54px;

    margin-top: 10px;

    border: none;

    border-radius: 14px;

    background: white;

    color: black;

    font-weight: 600;

    cursor: pointer;

    transition:
      transform 0.15s ease,
      opacity 0.2s ease;
  }

  .submit:hover {
    opacity: 0.92;
  }

  .submit:active {
    transform: scale(0.985);
  }

  /* Secundário em relação ao .submit (branco sólido): contorno translúcido,
     para o caminho por senha continuar sendo o primário visual. */
  .divisor {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 18px 0 4px;
    color: rgba(255, 255, 255, 0.35);
    font-size: 12px;
  }

  .divisor::before,
  .divisor::after {
    content: "";
    flex: 1;
    height: 1px;
    background: rgba(255, 255, 255, 0.12);
  }

  .google {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    height: 54px;
    margin-top: 10px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.04);
    color: inherit;
    font-weight: 600;
    font-size: 14px;
    text-decoration: none;
    cursor: pointer;
    transition:
      transform 0.15s ease,
      background 0.2s ease,
      border-color 0.2s ease;
  }

  .google:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.28);
  }

  .google:active {
    transform: scale(0.985);
  }

  .google svg {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
  }

  .footer {
    display: flex;
    justify-content: center;
    gap: 6px;

    margin-top: 28px;

    font-size: 14px;
  }

  .footer span {
    color: rgba(255, 255, 255, 0.45);
  }

  .footer button {
    background: transparent;
    border: none;

    color: white;

    cursor: pointer;

    font-weight: 500;
  }

  @media (max-width: 640px) {
    .auth-shell {
      padding: 24px;
    }

    .brand h1 {
      font-size: 30px;
    }
  }
</style>

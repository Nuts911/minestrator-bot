require("dotenv").config();

const { Client, GatewayIntentBits } = require("discord.js");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

let interval = null;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function log(channel, msg) {
    console.log("[LOG]", msg);
    if (channel) channel.send("📡 " + msg).catch(() => {});
}

// =======================
// COOKIES HEADER
// =======================
function getCookieHeader() {
    const parts = [];
    if (process.env.COOKIE_PHPSESSID)   parts.push(`PHPSESSID=${process.env.COOKIE_PHPSESSID}`);
    if (process.env.COOKIE_API_KEY)     parts.push(`api-key=${process.env.COOKIE_API_KEY}`);
    if (process.env.COOKIE_AUTH_STATE)  parts.push(`auth-state=${process.env.COOKIE_AUTH_STATE}`);
    if (process.env.COOKIE_CW)          parts.push(`cw_conversation=${process.env.COOKIE_CW}`);
    return parts.join("; ");
}

function getHeaders() {
    return {
        "Cookie": getCookieHeader(),
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9",
        "Referer": "https://minestrator.com/",
        "Origin": "https://minestrator.com"
    };
}

// =======================
// RESTART SERVER
// =======================
async function restartServer(channel) {
    try {

        await log(channel, "🌐 Connexion à MineStrator...");

        // Extrait l'ID du serveur depuis SERVER_URL
        // ex: https://minestrator.com/my/server/445749 → 445749
        const serverUrl = process.env.SERVER_URL || "";
        const serverId = serverUrl.split("/").filter(Boolean).pop();

        if (!serverId) {
            await log(channel, "❌ SERVER_URL invalide dans le .env");
            return;
        }

        console.log("[INFO] Server ID:", serverId);

        // ---- ÉTAPE 1 : Vérifie qu'on est connecté ----
        const checkRes = await fetch("https://minestrator.com/my/server/" + serverId, {
            headers: getHeaders(),
            redirect: "manual"
        });

        console.log("[CHECK] Status:", checkRes.status, "Location:", checkRes.headers.get("location"));

        if (checkRes.status === 302 || checkRes.status === 301) {
            const location = checkRes.headers.get("location") || "";
            if (location.includes("login")) {
                await log(channel, "❌ Cookies expirés ! Va sur minestrator.com, reconnecte-toi, et mets à jour COOKIE_PHPSESSID dans Render.");
                return;
            }
        }

        if (checkRes.status !== 200) {
            await log(channel, `❌ Erreur accès panel (HTTP ${checkRes.status})`);
            return;
        }

        await log(channel, "✅ Connecté ! Envoi de la commande restart...");

        // ---- ÉTAPE 2 : Cherche le token CSRF dans la page ----
        const html = await checkRes.text();

        // Cherche le token CSRF (ex: <meta name="csrf-token" content="XXX">)
        const csrfMatch = html.match(/name="csrf-token"\s+content="([^"]+)"/);
        const xsrfMatch = html.match(/_token['"]\s*:\s*['"]([^'"]+)['"]/);
        const csrfToken = csrfMatch?.[1] || xsrfMatch?.[1] || null;

        console.log("[CSRF]", csrfToken ? "Trouvé: " + csrfToken.substring(0, 20) + "..." : "Non trouvé");

        // ---- ÉTAPE 3 : Envoie la commande restart ----
        // Essaie plusieurs endpoints courants MineStrator
        const endpoints = [
            `https://minestrator.com/api/server/${serverId}/restart`,
            `https://minestrator.com/my/server/${serverId}/restart`,
            `https://minestrator.com/panel/server/${serverId}/restart`,
            `https://minestrator.com/api/servers/${serverId}/power`,
        ];

        let success = false;

        for (const endpoint of endpoints) {

            const headers = {
                ...getHeaders(),
                "Content-Type": "application/json",
                "X-Requested-With": "XMLHttpRequest",
                "Accept": "application/json, text/plain, */*",
            };

            if (csrfToken) {
                headers["X-CSRF-TOKEN"] = csrfToken;
            }

            // Body possible selon l'API
            const bodies = [
                JSON.stringify({ action: "restart" }),
                JSON.stringify({ signal: "restart" }),
                JSON.stringify({ power: "restart" }),
                ""
            ];

            for (const body of bodies) {

                const res = await fetch(endpoint, {
                    method: "POST",
                    headers,
                    body: body || undefined,
                    redirect: "manual"
                });

                console.log(`[RESTART] ${endpoint} | body: ${body} | status: ${res.status}`);

                if (res.status === 200 || res.status === 201 || res.status === 204) {
                    await log(channel, `🎉 RESTART LANCÉ ! (${endpoint})`);
                    success = true;
                    break;
                }
            }

            if (success) break;
        }

        if (!success) {
            await log(channel, "⚠️ Impossible de trouver l'endpoint restart automatiquement. Tape `!debug` pour analyser la page.");
        }

    } catch (err) {
        console.error("[ERREUR]", err);
        await log(channel, "❌ ERREUR: " + err.message);
    }
}

// =======================
// DEBUG — analyse la page
// =======================
async function debugPage(channel) {
    try {
        await log(channel, "🔍 Analyse de la page serveur...");

        const serverUrl = process.env.SERVER_URL || "";
        const serverId = serverUrl.split("/").filter(Boolean).pop();

        const res = await fetch("https://minestrator.com/my/server/" + serverId, {
            headers: getHeaders(),
            redirect: "manual"
        });

        await log(channel, `📊 Status HTTP: ${res.status}`);

        if (res.status === 302 || res.status === 301) {
            await log(channel, `↪️ Redirigé vers: ${res.headers.get("location")}`);
            return;
        }

        const html = await res.text();

        // Cherche les liens/boutons qui contiennent "restart"
        const restartMatches = html.match(/href="([^"]*restart[^"]*)"|action="([^"]*restart[^"]*)"|url\s*:\s*['"]([^'"]*restart[^'"]*)['"]/gi) || [];
        await log(channel, `🔗 Liens restart trouvés: ${restartMatches.slice(0, 5).join(" | ") || "aucun"}`);

        // Cherche les routes API dans le JS
        const apiMatches = html.match(/\/api\/[^'">\s]+/g) || [];
        const uniqueApi = [...new Set(apiMatches)].slice(0, 10);
        await log(channel, `🛣️ Routes API: ${uniqueApi.join(" | ") || "aucune"}`);

        // Cherche le token CSRF
        const csrfMatch = html.match(/name="csrf-token"\s+content="([^"]+)"/);
        await log(channel, `🔑 CSRF Token: ${csrfMatch ? "trouvé ✅" : "non trouvé ❌"}`);

        // Taille de la page
        await log(channel, `📄 Taille HTML: ${html.length} caractères`);

    } catch (err) {
        await log(channel, "❌ Erreur debug: " + err.message);
    }
}

// =======================
// STOP SYSTEM
// =======================
async function stopSystem(channel) {
    clearInterval(interval);
    interval = null;
    await log(channel, "🛑 Système arrêté proprement.");
}

// =======================
// DISCORD BOT
// =======================
client.once("ready", () => {
    console.log(`✅ Bot connecté : ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    const channel = message.channel;

    // !start
    if (message.content === "!start") {
        if (interval) return message.reply("⚠️ Le système est déjà actif !");
        await message.reply("🚀 Système activé ! Premier restart en cours...");
        await restartServer(channel);
        interval = setInterval(async () => {
            await log(channel, "⏱️ Restart automatique toutes les 3h...");
            await restartServer(channel);
        }, 3 * 60 * 60 * 1000);
    }

    // !stop
    if (message.content === "!stop") {
        await stopSystem(channel);
        await message.reply("🛑 Système arrêté.");
    }

    // !restart
    if (message.content === "!restart") {
        await message.reply("🔄 Restart manuel en cours...");
        await restartServer(channel);
    }

    // !status
    if (message.content === "!status") {
        if (interval) {
            await message.reply("✅ Système **actif** — restart auto toutes les 3h.");
        } else {
            await message.reply("🔴 Système **inactif** — tape `!start` pour démarrer.");
        }
    }

    // !debug — analyse la page et cherche les endpoints
    if (message.content === "!debug") {
        await message.reply("🔍 Analyse en cours...");
        await debugPage(channel);
    }
});

client.login(process.env.DISCORD_TOKEN);

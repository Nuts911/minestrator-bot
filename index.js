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
let cookies = {};

// =======================
// UTILITAIRES
// =======================
async function log(channel, msg) {
    console.log("[LOG]", msg);
    if (channel) channel.send("📡 " + msg).catch(() => {});
}

function buildCookieString(obj) {
    return Object.entries(obj).map(([k, v]) => `${k}=${v}`).join("; ");
}

function parseCookies(headers) {
    const result = {};
    for (const h of (headers || [])) {
        const part = h.split(";")[0].trim();
        const i = part.indexOf("=");
        if (i !== -1) result[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    return result;
}

// =======================
// LOGIN
// =======================
async function login(channel) {
    try {
        await log(channel, "🔐 Connexion à Minestrator...");

        if (!process.env.MINESTRATOR_EMAIL || !process.env.MINESTRATOR_PASSWORD) {
            await log(channel, "❌ Email ou mot de passe manquant dans les variables Railway !");
            return false;
        }

        // 1. Récupérer le CSRF token
        const r1 = await fetch("https://minestrator.com/login", {
            headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html" }
        });
        const c1 = parseCookies(r1.headers.getSetCookie());
        const html = await r1.text();
        const csrf = (html.match(/name="_token"\s+value="([^"]+)"/) || [])[1];
        console.log("[LOGIN] CSRF:", csrf ? "trouvé" : "introuvable");

        // 2. POST login
        const body = new URLSearchParams({
            email: process.env.MINESTRATOR_EMAIL,
            password: process.env.MINESTRATOR_PASSWORD,
            ...(csrf ? { _token: csrf } : {})
        });

        const r2 = await fetch("https://minestrator.com/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Cookie": buildCookieString(c1),
                "User-Agent": "Mozilla/5.0",
                "Origin": "https://minestrator.com",
                "Referer": "https://minestrator.com/login"
            },
            body: body.toString(),
            redirect: "manual"
        });

        const c2 = parseCookies(r2.headers.getSetCookie());
        cookies = { ...c1, ...c2 };
        console.log("[LOGIN] Status:", r2.status, "| Cookies:", Object.keys(cookies).join(", "));

        if (!cookies["PHPSESSID"] && !cookies["laravel_session"]) {
            await log(channel, "❌ Login échoué — vérifie ton email/mot de passe dans Railway.");
            return false;
        }

        await log(channel, "✅ Connecté à Minestrator !");
        return true;

    } catch (err) {
        console.error("[LOGIN ERREUR]", err);
        await log(channel, "❌ Erreur login: " + err.message);
        return false;
    }
}

// =======================
// RESTART
// =======================
async function restart(channel) {
    try {
        // Login si nécessaire
        if (!cookies["PHPSESSID"] && !cookies["laravel_session"]) {
            const ok = await login(channel);
            if (!ok) return;
        }

        await log(channel, "🔄 Envoi restart...");

        const serverId = (process.env.SERVER_URL || "").split("/").filter(Boolean).pop();
        if (!serverId) {
            await log(channel, "❌ SERVER_URL manquant !");
            return;
        }

        const res = await fetch(`https://mine.sttr.io/server/${serverId}/poweraction`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Cookie": buildCookieString(cookies),
                "Origin": "https://minestrator.com",
                "Referer": "https://minestrator.com/",
                "User-Agent": "Mozilla/5.0"
            },
            body: JSON.stringify({ poweraction: "restart" })
        });

        const text = await res.text().catch(() => "");
        console.log("[RESTART] Status:", res.status, "| Body:", text.slice(0, 200));

        if ([200, 201, 204].includes(res.status)) {
            await log(channel, "🎉 RESTART LANCÉ AVEC SUCCÈS !");
            return;
        }

        // Session expirée → reconnexion UNE seule fois
        if ([401, 403].includes(res.status)) {
            await log(channel, "⚠️ Session expirée, reconnexion...");
            cookies = {};
            const ok = await login(channel);
            if (!ok) return;

            const res2 = await fetch(`https://mine.sttr.io/server/${serverId}/poweraction`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "Cookie": buildCookieString(cookies),
                    "Origin": "https://minestrator.com",
                    "Referer": "https://minestrator.com/",
                    "User-Agent": "Mozilla/5.0"
                },
                body: JSON.stringify({ poweraction: "restart" })
            });

            const text2 = await res2.text().catch(() => "");
            console.log("[RESTART2] Status:", res2.status, "| Body:", text2.slice(0, 200));

            if ([200, 201, 204].includes(res2.status)) {
                await log(channel, "🎉 RESTART LANCÉ AVEC SUCCÈS !");
            } else {
                await log(channel, `❌ Échec (HTTP ${res2.status})\n\`\`\`${text2.slice(0, 200)}\`\`\``);
            }
            return;
        }

        await log(channel, `❌ Échec (HTTP ${res.status})\n\`\`\`${text.slice(0, 200)}\`\`\``);

    } catch (err) {
        console.error("[RESTART ERREUR]", err);
        await log(channel, "❌ ERREUR: " + err.message);
    }
}

// =======================
// DISCORD
// =======================
client.once("ready", () => {
    console.log(`✅ Bot connecté : ${client.user.tag}`);
    login(null).catch(err => console.error("[INIT]", err.message));
});

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    const ch = message.channel;

    if (message.content === "!start") {
        if (interval) return message.reply("⚠️ Déjà actif !");
        await message.reply("🚀 Système activé !");
        await restart(ch);
        interval = setInterval(async () => {
            await log(ch, "⏱️ Restart automatique (3h)...");
            await restart(ch);
        }, 3 * 60 * 60 * 1000);
    }

    if (message.content === "!stop") {
        clearInterval(interval);
        interval = null;
        await message.reply("🛑 Système arrêté.");
    }

    if (message.content === "!restart") {
        await message.reply("🔄 Restart manuel...");
        await restart(ch);
    }

    if (message.content === "!status") {
        await message.reply(interval
            ? "✅ **Actif** — restart auto toutes les 3h."
            : "🔴 **Inactif** — tape `!start`."
        );
    }

    if (message.content === "!debug") {
        const sid = (process.env.SERVER_URL || "").split("/").filter(Boolean).pop();
        await message.reply(
            `🔧 **Debug:**\n` +
            `• SERVER_ID: \`${sid || "❌"}\`\n` +
            `• EMAIL: ${process.env.MINESTRATOR_EMAIL ? "✅" : "❌"}\n` +
            `• PASSWORD: ${process.env.MINESTRATOR_PASSWORD ? "✅" : "❌"}\n` +
            `• Session: ${(cookies["PHPSESSID"] || cookies["laravel_session"]) ? "✅" : "🔴"}\n` +
            `• Intervalle: ${interval ? "✅" : "🔴"}`
        );
    }

    if (message.content === "!login") {
        cookies = {};
        await login(ch);
    }
});

client.login(process.env.DISCORD_TOKEN);

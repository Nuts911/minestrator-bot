require("dotenv").config();
const { Client, GatewayIntentBits, AttachmentBuilder, EmbedBuilder } = require("discord.js");
const puppeteer = require("puppeteer");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

let autoRestartInterval = null;

// Configuration de Puppeteer optimisée pour Railway (évite les crashs de mémoire)
const puppeteerOptions = {
    headless: "new",
    args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu"
    ]
};

// ==========================================
// NAVIGATION ET AUTHENTIFICATION RÉELLE
// ==========================================
async function navigateToPanel() {
    const browser = await puppeteer.launch(puppeteerOptions);
    const page = await browser.newPage();
    
    // Définir une taille de fenêtre fixe pour uniformiser le screenshot
    await page.setViewport({ width: 1400, height: 900 });

    try {
        console.log("[PUPPETEER] Ouverture de la page de connexion...");
        await page.goto("https://minestrator.com/login", { waitUntil: "networkidle2" });

        // Saisie des vrais identifiants
        await page.type('input[name="email"]', process.env.MINESTRATOR_EMAIL);
        await page.type('input[name="password"]', process.env.MINESTRATOR_PASSWORD);
        
        const rememberCheckbox = await page.$('input[name="remember"]');
        if (rememberCheckbox) await rememberCheckbox.click();

        // Clic sur le bouton Soumettre et attente du chargement
        await Promise.all([
            page.click('button[type="submit"]'),
            page.waitForNavigation({ waitUntil: "networkidle2" })
        ]);

        console.log("[PUPPETEER] Connexion réussie. Navigation vers le serveur...");
        
        // Accès direct à l'URL de ton serveur (445749)
        await page.goto(process.env.SERVER_URL, { waitUntil: "networkidle2" });
        
        return { browser, page };
    } catch (error) {
        await browser.close();
        throw error;
    }
}

// ==========================================
// ROUTINE DES ACTIONS DE PUISSANCE (CLICS)
// ==========================================
async function triggerPowerAction(actionName) {
    const { browser, page } = await navigateToPanel();
    
    try {
        // Attente de sécurité pour l'apparition des éléments du panel
        await page.waitForSelector("body", { timeout: 10000 });

        // Recherche dynamique et robuste du bouton selon l'action souhaitée
        const actionExecuted = await page.evaluate((action) => {
            const elements = Array.from(document.querySelectorAll('button, a, span, i'));
            
            // Mots-clés ciblés en français et anglais correspondants aux boutons de Minestrator
            const keywords = {
                start: ['démarrer', 'start', 'fa-play'],
                stop: ['arrêter', 'stop', 'éteindre', 'kill', 'fa-stop'],
                restart: ['redémarrer', 'restart', 'fa-redo', 'fa-refresh']
            };

            const targets = keywords[action];
            
            // Parcourir les éléments pour trouver le bouton correspondant
            for (const el of elements) {
                const text = el.textContent ? el.textContent.toLowerCase() : "";
                const html = el.innerHTML ? el.innerHTML.toLowerCase() : "";
                
                const matchFound = targets.some(target => text.includes(target) || html.includes(target));
                
                if (matchFound) {
                    // Si l'élément trouvé n'est pas cliquable (ex: une icône i), on remonte jusqu'au bouton/lien parent
                    const clickable = el.closest('button') || el.closest('a') || el;
                    clickable.click();
                    return true;
                }
            }
            return false;
        }, actionName.toLowerCase());

        // Attente pour laisser le temps à la requête AJAX de s'exécuter sur le site
        await new Promise(r => setTimeout(r, 4000));
        await browser.close();
        return actionExecuted;
    } catch (err) {
        await browser.close();
        throw err;
    }
}

// ==========================================
// GESTION DES COMMANDES DISCORD
// ==========================================
client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.content.startsWith("!")) return;

    const command = message.content.toLowerCase();
    const ch = message.channel;

    // ----- COMMANDE !SCREEN -----
    if (command === "!screen") {
        const waiting = await message.reply("📸 Connexion en cours et capture d'écran du panel...");
        
        try {
            const { browser, page } = await navigateToPanel();
            
            // Laisser le temps à la console et aux graphiques de charger leurs données dynamiques
            await new Promise(r => setTimeout(r, 4000));

            // Capture d'écran sous forme de buffer d'image
            const screenshotBuffer = await page.screenshot({ fullPage: false });
            await browser.close();

            const attachment = new AttachmentBuilder(screenshotBuffer, { name: "panel.png" });
            const embed = new EmbedBuilder()
                .setTitle("🖥️ Visualisation Réelle de votre Panel")
                .setDescription(`Affichage en direct du serveur spécifié dans vos configurations.`)
                .setImage("attachment://panel.png")
                .setColor(0x3498db)
                .setTimestamp();

            await waiting.delete();
            await message.reply({ embeds: [embed], files: [attachment] });

        } catch (err) {
            console.error("[ERREUR SCREEN]", err);
            await waiting.edit("❌ Impossible de capturer le panel. Assurez-vous que vos identifiants ou l'URL du serveur sont corrects.");
        }
    }

    // ----- COMMANDE !START -----
    if (command === "!start") {
        if (autoRestartInterval) return message.reply("⚠️ Le cycle d'auto-restart (3h) est déjà en cours.");
        
        const waiting = await message.reply("⚡ Envoi du signal d'allumage via la simulation de clic...");

        try {
            const success = await triggerPowerAction("start");

            if (success) {
                // Initialisation de la boucle de redémarrage automatique toutes les 3 heures
                autoRestartInterval = setInterval(async () => {
                    console.log("[AUTO-LOOP] Déclenchement automatique du restart de 3h...");
                    try {
                        await triggerPowerAction("restart");
                    } catch (e) {
                        console.error("[AUTO-LOOP ERREUR]", e.message);
                    }
                }, 3 * 60 * 60 * 1000);

                await waiting.edit("🚀 Ordre de **Démarrage** transmis avec succès.\n⏱️ Cycle de redémarrage automatique toutes les 3 heures : **Activé**.");
            } else {
                await waiting.edit("⚠️ Le bouton d'allumage n'a pas pu être détecté. Le serveur est peut-être déjà en ligne.");
            }
        } catch (err) {
            console.error("[ERREUR START]", err);
            await waiting.edit("❌ Échec lors de la tentative d'allumage.");
        }
    }

    // ----- COMMANDE !STOP -----
    if (command === "!stop") {
        const waiting = await message.reply("🛑 Envoi du signal d'arrêt et désactivation des tâches de fond...");

        if (autoRestartInterval) {
            clearInterval(autoRestartInterval);
            autoRestartInterval = null;
        }

        try {
            const success = await triggerPowerAction("stop");
            if (success) {
                await waiting.edit("✅ Ordre d'**Arrêt** transmis avec succès.\n🛑 Le cycle de redémarrage automatique de 3 heures a été **Désactivé**.");
            } else {
                await waiting.edit("⚠️ Le bouton d'arrêt n'a pas pu être détecté. Le serveur est probablement déjà éteint.");
            }
        } catch (err) {
            console.error("[ERREUR STOP]", err);
            await waiting.edit("❌ Échec lors de la tentative d'arrêt.");
        }
    }
});

client.once("ready", () => {
    console.log(`✅ Robot d'automatisation démarré sous l'identité : ${client.user.tag}`);
});

process.on("unhandledRejection", (reason) => {
    console.error("[ANTI-CRASH] Rejection non gérée évitée :", reason);
});

client.login(process.env.DISCORD_TOKEN);
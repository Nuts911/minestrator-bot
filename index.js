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
// FONCTION COMMUNE : CONNEXION ET NAVIGATION
// ==========================================
async function navigateToPanel() {
    const browser = await puppeteer.launch(puppeteerOptions);
    const page = await browser.newPage();
    
    // Définir une taille d'écran standard pour le screenshot
    await page.setViewport({ width: 1400, height: 900 });

    try {
        console.log("[PUPPETEER] Connexion à Minestrator...");
        await page.goto("https://minestrator.com/login", { waitUntil: "networkidle2" });

        // Remplir le formulaire de connexion réel
        await page.type('input[name="email"]', process.env.MINESTRATOR_EMAIL);
        await page.type('input[name="password"]', process.env.MINESTRATOR_PASSWORD);
        
        // Cocher "Se souvenir de moi" pour stabiliser la session
        const rememberCheckbox = await page.$('input[name="remember"]');
        if (rememberCheckbox) await rememberCheckbox.click();

        // Cliquer sur le bouton de connexion
        await Promise.all([
            page.click('button[type="submit"]'),
            page.waitForNavigation({ waitUntil: "networkidle2" })
        ]);

        console.log("[PUPPETEER] Accès au panel du serveur...");
        // Aller directement sur l'URL de ton serveur
        await page.goto(process.env.SERVER_URL, { waitUntil: "networkidle2" });
        
        return { browser, page };
    } catch (error) {
        await browser.close();
        throw error;
    }
}

// ==========================================
// LOGIQUE DES COMMANDES
// ==========================================

client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.content.startsWith("!")) return;

    const command = message.content.toLowerCase();

    // ----- COMMANDE !SCREEN -----
    if (command === "!screen") {
        const waitingMessage = await message.reply("📸 Connexion à Minestrator et capture d'écran en cours...");
        
        try {
            const { browser, page } = await navigateToPanel();
            
            // Attendre un peu que les graphiques ou la console chargent sur la page
            await new Promise(r => setTimeout(r, 3000));

            // Prendre le screenshot réel
            const screenshotBuffer = await page.screenshot({ fullPage: false });
            await browser.close();

            // Envoi de la vraie image sur Discord
            const attachment = new AttachmentBuilder(screenshotBuffer, { name: "panel-screenshot.png" });
            const embed = new EmbedBuilder()
                .setTitle("🖥️ Statut Réel du Panel Minestrator")
                .setURL(process.env.SERVER_URL)
                .setImage("attachment://panel-screenshot.png")
                .setColor(0x3498db)
                .setTimestamp();

            await waitingMessage.delete();
            await message.reply({ embeds: [embed], files: [attachment] });

        } catch (err) {
            console.error(err);
            await waitingMessage.edit("❌ Impossible de prendre une capture d'écran. Vérifie tes identifiants ou si le site est accessible.");
        }
    }

    // ----- COMMANDE !START (ALLUMAGE + ROUTINE 3H) -----
    if (command === "!start") {
        if (autoRestartInterval) return message.reply("⚠️ La routine d'auto-restart de 3h est déjà active !");
        
        const waitingMessage = await message.reply("⚡ Tentative d'allumage du serveur via le panel...");

        try {
            const { browser, page } = await navigateToPanel();

            // Sélecteur générique pour le bouton de démarrage (Minestrator utilise souvent des classes spécifiques ou des icônes)
            // On cherche un bouton qui contient l'action ou la couleur verte de démarrage
            const startClicked = await page.evaluate(() => {
                // Recherche du bouton Start par sa classe ou son texte de manière brute
                const buttons = Array.from(document.querySelectorAll('button, a'));
                const startBtn = buttons.find(b => 
                    b.textContent.toLowerCase().includes('démarrer') || 
                    b.textContent.toLowerCase().includes('start') ||
                    b.innerHTML.includes('fa-play')
                );
                if (startBtn) {
                    startBtn.click();
                    return true;
                }
                return false;
            });

            await new Promise(r => setTimeout(r, 2000));
            await browser.close();

            if (startClicked) {
                // Activer la boucle de redémarrage toutes les 3 heures
                autoRestartInterval = setInterval(async () => {
                    console.log("[AUTO] Exécution du redémarrage automatique des 3h...");
                    try {
                        const { browser: b, page: p } = await navigateToPanel();
                        await p.evaluate(() => {
                            const btns = Array.from(document.querySelectorAll('button, a'));
                            const restartBtn = btns.find(btn => 
                                btn.textContent.toLowerCase().includes('redémarrer') || 
                                btn.textContent.toLowerCase().includes('restart') ||
                                btn.innerHTML.includes('fa-redo')
                            );
                            if (restartBtn) restartBtn.click();
                        });
                        await new Promise(r => setTimeout(r, 2000));
                        await b.close();
                    } catch (e) {
                        console.error("[AUTO] Échec du restart automatique:", e);
                    }
                }, 3 * 60 * 60 * 1000);

                await waitingMessage.edit("🚀 Le serveur a reçu l'ordre de **Démarrage**.\n⏱️ La routine de redémarrage automatique (toutes les 3h) est maintenant **Activée** !");
            } else {
                await waitingMessage.edit("⚠️ Impossible de trouver le bouton 'Démarrer' sur la page. Es-tu sûr que le serveur n'est pas déjà en ligne ?");
            }

        } catch (err) {
            console.error(err);
            await waitingMessage.edit("❌ Erreur lors de la tentative d'allumage.");
        }
    }

    // ----- COMMANDE !STOP (EXTINCTION + ARRÊT DE LA BOUCLE) -----
    if (command === "!stop") {
        const waitingMessage = await message.reply("🛑 Tentative d'arrêt du serveur via le panel...");

        if (autoRestartInterval) {
            clearInterval(autoRestartInterval);
            autoRestartInterval = null;
        }

        try {
            const { browser, page } = await navigateToPanel();

            const stopClicked = await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button, a'));
                const stopBtn = buttons.find(b => 
                    b.textContent.toLowerCase().includes('arrêter') || 
                    b.textContent.toLowerCase().includes('stop') || 
                    b.textContent.toLowerCase().includes('éteindre') ||
                    b.innerHTML.includes('fa-stop')
                );
                if (stopBtn) {
                    stopBtn.click();
                    return true;
                }
                return false;
            });

            await new Promise(r => setTimeout(r, 2000));
            await browser.close();

            if (stopClicked) {
                await waitingMessage.edit("✅ Le serveur a reçu l'ordre d'**Arrêt**.\n🛑 La routine d'auto-restart de 3h a été **Désactivée**.");
            } else {
                await waitingMessage.edit("⚠️ Impossible de trouver le bouton 'Arrêter' sur la page. Le serveur est peut-être déjà coupé.");
            }

        } catch (err) {
            console.error(err);
            await waitingMessage.edit("❌ Erreur lors de la tentative d'arrêt.");
        }
    }
});

client.once("ready", () => {
    console.log(`[BOT] Connecté en tant que ${client.user.tag}`);
});

// Protection contre le crash du processus sur Railway
process.on("unhandledRejection", (error) => {
    console.error("[CRASH PREVENTED] Erreur non gérée :", error);
});

client.login(process.env.DISCORD_TOKEN);
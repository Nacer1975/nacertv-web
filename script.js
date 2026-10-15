/* =====================================================
   🎬 NacerTV — Script principal
   ===================================================== */

// ===== CONFIGURATION =====
const HASH = "2e1cfa82b035c26cbbbdae632cea0705";

// 🎯 Proxy CORS pour contourner les blocages navigateur
// 🎯 Proxy Cloudflare Worker
const WORKER = "https://nacertv-proxy.bnacer0906.workers.dev/?target=";

const REDIRECT_SERVER = WORKER + encodeURIComponent(`http://${HASH}.fastapisource.shop/redirect/`);
const SERVER_HUB = WORKER + encodeURIComponent(`http://${HASH}.fastapihub.shop/search/v3/`);
const GITHUB_BASE = "https://raw.githubusercontent.com/Nacer1975/nacertv-channels/refs/heads/main/";
const FILES = {
    tv: GITHUB_BASE + "channels.Json.gz",
    radio: GITHUB_BASE + "radios.json.gz",
    shows: GITHUB_BASE + "shows.json.gz"
};

// Clés AES (pour re-résolution .LS.V2)
const AES_KEY = "0123456789abcdef";
const AES_IV = "fedcba9876543210";

// ===== ÉTAT =====
let allItems = [];
let filteredItems = [];
let currentTab = "tv";
let currentCategory = "Tout";
let currentSearch = "";
let hls = null;

// 🎯 Pagination
let displayedCount = 0;
const PAGE_SIZE = 50;
let currentObserver = null;

// ===== ÉLÉMENTS DOM =====
const categoriesContainer = document.getElementById("categoriesContainer");
const channelsContainer = document.getElementById("channelsContainer");
const statsText = document.getElementById("statsText");
const searchInput = document.getElementById("searchInput");
const refreshBtn = document.getElementById("refreshBtn");
const playerModal = document.getElementById("playerModal");
const playerTitle = document.getElementById("playerTitle");
const playerStatus = document.getElementById("playerStatus");
const videoPlayer = document.getElementById("videoPlayer");
const closePlayer = document.getElementById("closePlayer");
const tabs = document.querySelectorAll(".tab");

// =====================================================
// 🔓 DÉCHIFFREMENT AES
// =====================================================
function decryptAES(payload) {
    try {
        payload = payload.trim().replace(/[\t\r\n ]/g, "");
        let cipherB64, ivB64;
        if (payload.includes(":")) {
            const parts = payload.split(":");
            cipherB64 = parts[0];
            ivB64 = parts[1];
        } else {
            cipherB64 = payload;
            ivB64 = btoa(AES_IV);
        }

        while (cipherB64.length % 4 !== 0) cipherB64 += "=";
        while (ivB64.length % 4 !== 0) ivB64 += "=";

        const key = CryptoJS.enc.Latin1.parse(AES_KEY);
        const iv = CryptoJS.enc.Base64.parse(ivB64);
        const cipherBytes = CryptoJS.enc.Base64.parse(cipherB64);

        const decrypted = CryptoJS.AES.decrypt(
            { ciphertext: cipherBytes },
            key,
            { iv: iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
        );
        return decrypted.toString(CryptoJS.enc.Utf8);
    } catch (e) {
        console.error("Erreur decrypt:", e);
        return null;
    }
}

function encryptAES(plaintext) {
    const key = CryptoJS.enc.Latin1.parse(AES_KEY);
    const iv = CryptoJS.enc.Latin1.parse(AES_IV);
    const encrypted = CryptoJS.AES.encrypt(plaintext, key, {
        iv: iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
    });
    return encrypted.ciphertext.toString(CryptoJS.enc.Base64) + ":" + btoa(AES_IV);
}

// =====================================================
// 📞 APPEL API
// =====================================================
async function callApi(baseUrl, endpoint, extra) {
    const basePayload = {
        user_id: "test",
        device_id: "f45b20a7-21ee-4984-88e8-ddebb885cd58",
        device_api: "33",
        version_name: "185",
        language: "fr",
        timezone: "Africa/Algiers",
        device_type: "phone",
        KEY_ACTIVATED_TYPE: "202122",
        store: "playStore",
        isStoreVersion: false,
        isPremium: false,
        isCoupon_active: false,
        hideAds: false,
        appCount: '{"adsFailed":0,"adsLoaded":0,"adsShowed":0,"runCount":1}',
        mainServer: "http://main.backendcoreapi.com/api/live/livedrama/v13.0.0/"
    };
    const payload = Object.assign({}, basePayload, extra);
    const encrypted = encryptAES(JSON.stringify(payload));

    const resp = await fetch(baseUrl + endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: encrypted
    });
    const text = await resp.text();
    const decrypted = decryptAES(text);
    return JSON.parse(decrypted);
}

async function resolveLsv2(idLive, lsv2Url) {
    try {
        const resp = await callApi(REDIRECT_SERVER, "getLiveByRedirect", {
            id: idLive,
            url: lsv2Url,
            agent: "redirect"
        });
        if (resp.result !== 0) return null;
        const inner = JSON.parse(resp.data.url);
        return {
            url: inner.url,
            agent: inner.agent,
            swap: inner.swap || {}
        };
    } catch (e) {
        console.error("resolveLsv2 error:", e);
        return null;
    }
}

// =====================================================
// 📥 CHARGEMENT DES DONNÉES
// =====================================================
async function loadTab(tab) {
    channelsContainer.innerHTML = '<div class="loading">⏳ Chargement...</div>';
    categoriesContainer.innerHTML = "";
    statsText.textContent = "Chargement...";

    try {
        const resp = await fetch(FILES[tab]);
        const gzBlob = await resp.arrayBuffer();
        const decompressed = await decompressGzip(gzBlob);
        allItems = JSON.parse(decompressed);

        console.log(`✅ ${allItems.length} éléments chargés pour ${tab}`);
        filteredItems = [...allItems];
        buildCategories();
        renderChannels();
    } catch (e) {
        console.error("Erreur chargement:", e);
        channelsContainer.innerHTML = '<div class="no-results">❌ Erreur: ' + e.message + '</div>';
        statsText.textContent = "Erreur de chargement";
    }
}

async function decompressGzip(arrayBuffer) {
    const ds = new DecompressionStream("gzip");
    const stream = new Blob([arrayBuffer]).stream().pipeThrough(ds);
    return await new Response(stream).text();
}

// =====================================================
// 🏷️ CONSTRUCTION DES CATÉGORIES
// =====================================================
function buildCategories() {
    const counts = {};
    counts["Tout"] = allItems.length;

    for (const item of allItems) {
        let t = item.topic || item.topic_name || "Autre";
        counts[t] = (counts[t] || 0) + 1;
    }

    categoriesContainer.innerHTML = "";

    for (const [name, count] of Object.entries(counts)) {
        const btn = document.createElement("button");
        btn.className = "category-btn" + (name === currentCategory ? " active" : "");

        const countryCode = getCountryCode(name);
        if (countryCode) {
            const img = document.createElement("img");
            img.src = `https://flagcdn.com/w80/${countryCode}.png`;
            img.alt = name;
            img.loading = "lazy";
            btn.appendChild(img);
        }

        const span = document.createElement("span");
        span.className = "cat-name";
        span.textContent = `${name} (${count})`;
        btn.appendChild(span);

        btn.onclick = () => {
            currentCategory = name;
            buildCategories();
            applyFilters();
        };

        categoriesContainer.appendChild(btn);
    }
}

// =====================================================
// 🎯 AFFICHAGE DES CHAÎNES (avec pagination)
// =====================================================
function renderChannels() {
    if (filteredItems.length === 0) {
        channelsContainer.innerHTML = '<div class="no-results">❌ Aucun résultat</div>';
        statsText.textContent = "0 résultat";
        return;
    }

    channelsContainer.innerHTML = "";
    displayedCount = 0;

    if (currentObserver) currentObserver.disconnect();

    renderNextBatch();

    // 🔄 Infinite scroll
    currentObserver = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && displayedCount < filteredItems.length) {
            renderNextBatch();
        }
    }, { rootMargin: "400px" });

    statsText.textContent = `${filteredItems.length} résultat(s)`;
}

function renderNextBatch() {
    const sentinel = document.getElementById("scrollSentinel");
    if (sentinel) sentinel.remove();

    const end = Math.min(displayedCount + PAGE_SIZE, filteredItems.length);
    const fragment = document.createDocumentFragment();

    for (let i = displayedCount; i < end; i++) {
        const item = filteredItems[i];
        const wrapper = document.createElement("div");
        wrapper.className = "channel-card-wrapper";

        const card = document.createElement("div");
        card.className = "channel-card";

        // Logo (lazy loading)
        const logo = document.createElement("img");
        logo.className = "channel-logo";
        logo.loading = "lazy";
        logo.src = item.logo || item.image || "";
        logo.alt = item.name || "";
        logo.onerror = () => {
            logo.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect fill='%232A2A4E' width='100' height='100'/%3E%3Ctext x='50' y='55' text-anchor='middle' fill='%23666' font-size='40'%3E📺%3C/text%3E%3C/svg%3E";
        };
        card.appendChild(logo);

        // Nom
        const name = document.createElement("div");
        name.className = "channel-name";
        name.textContent = item.name || "Sans nom";
        card.appendChild(name);

        // Topic
        const topic = document.createElement("div");
        topic.className = "channel-topic";
        topic.textContent = item.topic || item.topic_name || "";
        card.appendChild(topic);

        // Badge
        const badge = document.createElement("span");
        badge.className = "channel-badge";
        const url = (item.url || "").toLowerCase();
        if (url.includes("4k") || url.includes("2160")) {
            badge.textContent = "4K";
            badge.style.background = "var(--badge-4k)";
            badge.style.color = "#000";
        } else if (url.includes("1080")) {
            badge.textContent = "FHD";
            badge.style.background = "var(--badge-fhd)";
        } else if (url.includes("720")) {
            badge.textContent = "HD";
            badge.style.background = "var(--badge-hd)";
        } else if (url.includes(".m3u8") || url.includes("index.html")) {
            badge.textContent = "LIVE";
            badge.style.background = "var(--badge-live)";
        } else {
            badge.style.display = "none";
        }
        wrapper.appendChild(badge);

        wrapper.appendChild(card);

        card.onclick = () => {
            if (currentTab === "shows") {
                openShow(item);
            } else {
                playItem(item);
            }
        };

        fragment.appendChild(wrapper);
    }

    channelsContainer.appendChild(fragment);

    // Ajouter le sentinel à la fin
    const newSentinel = document.createElement("div");
    newSentinel.id = "scrollSentinel";
    newSentinel.style.height = "20px";
    newSentinel.style.gridColumn = "1 / -1";
    channelsContainer.appendChild(newSentinel);

    if (currentObserver) currentObserver.observe(newSentinel);

    displayedCount = end;
}

// =====================================================
// 🔍 FILTRES
// =====================================================
function applyFilters() {
    const search = currentSearch.toLowerCase().trim();

    filteredItems = allItems.filter(item => {
        let matchesCategory;
        if (currentCategory === "Tout") matchesCategory = true;
        else matchesCategory = (item.topic || item.topic_name || "Autre") === currentCategory;

        let matchesSearch = true;
        if (search) {
            const n = (item.name || "").toLowerCase();
            const t = (item.topic || item.topic_name || "").toLowerCase();
            matchesSearch = n.includes(search) || t.includes(search);
        }

        return matchesCategory && matchesSearch;
    });

    renderChannels();
}

// =====================================================
// 🎬 LECTURE VIDÉO
// =====================================================

async function playItem(item) {
    playerModal.classList.add("active");
    playerTitle.textContent = item.name || "Chaîne";
    playerStatus.textContent = "⏳ Chargement...";

    let url = item.url;
    let agent = item.agent || "Mozilla/5.0";
    let swap = item.swap || null;

    // Re-résolution .LS.V2 si dispo
    const server = item.servers && item.servers[0];
    if (server && server.lsv2 && item.id_live) {
        playerStatus.textContent = "🔄 Résolution du flux...";
        const resolved = await resolveLsv2(item.id_live, server.lsv2);
        if (resolved) {
            url = resolved.url;
            agent = resolved.agent || agent;
            swap = resolved.swap || swap;
        }
    }

    if (!url) {
        playerStatus.textContent = "❌ URL invalide";
        return;
    }

    console.log("URL brute:", url);

    // Extraire le swap
    let swapKey = "";
    let swapValue = "";
    if (swap && typeof swap === "object") {
        const keys = Object.keys(swap);
        if (keys.length > 0) {
            swapKey = keys[0];
            swapValue = swap[swapKey];
            console.log(`🔧 Swap: "${swapKey}" → "${swapValue}"`);
        }
    }

    // 🎯 Passer par le Worker
    const finalUrl = WORKER + encodeURIComponent(url);
    console.log("URL finale:", finalUrl);

    // Détruire l'ancien lecteur
    if (hls) {
        hls.destroy();
        hls = null;
    }

    if (Hls.isSupported()) {
        // 🎯 Loader qui applique le swap
        const SwappingLoader = class extends Hls.DefaultConfig.loader {
            load(context, config, callbacks) {
                let targetUrl = context.url;

                // Si l'URL n'est pas encore passée par le Worker, la proxifier
                if (!targetUrl.includes("nacertv-proxy")) {
                    // Swap si nécessaire
                    if (swapKey && targetUrl.includes(swapKey)) {
                        targetUrl = targetUrl.replace(swapKey, swapValue);
                    }
                    // Proxifier
                    targetUrl = WORKER + encodeURIComponent(targetUrl);
                }

                context.url = targetUrl;
                super.load(context, config, callbacks);
            }
        };

        hls = new Hls({
            pLoader: SwappingLoader,
            fLoader: SwappingLoader,
            enableWorker: false,
            lowLatencyMode: false,
            manifestLoadingTimeOut: 30000,
            manifestLoadingMaxRetry: 4,
            levelLoadingTimeOut: 30000,
            fragLoadingTimeOut: 60000,
        });

        hls.loadSource(finalUrl);
        hls.attachMedia(videoPlayer);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            playerStatus.textContent = "▶️ Lecture";
            videoPlayer.play().catch(e => console.error(e));
        });

        hls.on(Hls.Events.ERROR, (event, data) => {
            console.error("HLS error:", data);
            if (data.fatal) {
                playerStatus.textContent = "❌ Erreur: " + data.details;
            }
        });
    } else {
        playerStatus.textContent = "❌ HLS non supporté";
    }
}

// =====================================================
// 🎬 SÉRIES — Ouvrir une série
// =====================================================
async function openShow(show) {
    const showId = show.id_live || show.id;
    if (!showId) return;

    playerStatus.textContent = "⏳ Chargement des épisodes...";
    playerModal.classList.add("active");
    playerTitle.textContent = show.name || "Série";

    try {
        const resp = await callApi(SERVER_HUB, "getShowEpisodes", { id: showId });
        const episodes = (resp.data || []).filter(e => e && e.id);

        if (episodes.length === 0) {
            playerStatus.textContent = "❌ Aucun épisode";
            return;
        }

        console.log(`${episodes.length} épisodes trouvés`);
        alert(`${episodes.length} épisodes trouvés. UI à faire pour les afficher.`);

    } catch (e) {
        console.error("openShow error:", e);
        playerStatus.textContent = "❌ Erreur: " + e.message;
    }
}

// =====================================================
// 🌍 CODES PAYS
// =====================================================
function getCountryCode(topic) {
    const map = {
        "Algeria": "dz", "Morocco": "ma", "Tunisia": "tn", "Libya": "ly",
        "Egypt": "eg", "Mauritania": "mr", "Sudan": "sd", "Saudi Arabia": "sa",
        "United Arab Emirates": "ae", "Qatar": "qa", "Kuwait": "kw", "Bahrain": "bh",
        "Oman": "om", "Yemen": "ye", "Iraq": "iq", "Jordan": "jo", "Lebanon": "lb",
        "Syria": "sy", "Palestine": "ps", "France": "fr", "Germany": "de",
        "Italy": "it", "Spain": "es", "United Kingdom": "gb", "Turkey": "tr",
        "United States": "us", "USA": "us", "Canada": "ca", "India": "in",
        "Pakistan": "pk", "Japan": "jp", "South Korea": "kr", "Korea": "kr",
        "Afghanistan": "af", "Somalia": "so"
    };
    return map[topic] || "";
}

// =====================================================
// 🎛️ ÉVÉNEMENTS
// =====================================================
tabs.forEach(tab => {
    tab.onclick = () => {
        tabs.forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        currentTab = tab.dataset.tab;
        currentCategory = "Tout";
        currentSearch = "";
        searchInput.value = "";
        loadTab(currentTab);
    };
});

searchInput.oninput = (e) => {
    currentSearch = e.target.value;
    applyFilters();
};

refreshBtn.onclick = () => {
    refreshBtn.classList.add("spinning");
    loadTab(currentTab).finally(() => {
        refreshBtn.classList.remove("spinning");
    });
};

closePlayer.onclick = () => {
    if (hls) {
        hls.destroy();
        hls = null;
    }
    videoPlayer.pause();
    videoPlayer.src = "";
    playerModal.classList.remove("active");
};

// =====================================================
// 🚀 DÉMARRAGE
// =====================================================
loadTab("tv");

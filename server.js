export default {
    async fetch(request, env) {
        const SUPABASE_URL = env.SUPABASE_URL;
        const SUPABASE_KEY = env.SUPABASE_KEY;

        const headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json",
            "Prefer": "return=representation"
        };

        const url = new URL(request.url);
        const method = request.method;

        const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), {
            status,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });

        const getBody = async () => { try { return await request.json(); } catch { return {}; } };
        const now = Date.now();

        // POST /api/manox/register
        if (method === "POST" && url.pathname === "/api/manox/register") {
            const { username, userId } = await getBody();
            if (!username || username.trim() === "") return jsonResponse({ success: false, message: "Username inválido" }, 400);

            const cleanUsername = username.trim();

            await fetch(`${SUPABASE_URL}/rest/v1/online_users`, {
                method: "POST",
                headers: { ...headers, "Prefer": "resolution=merge-duplicates" },
                body: JSON.stringify({ username: cleanUsername, user_id: userId || null, last_seen: now })
            });

            const getRes = await fetch(`${SUPABASE_URL}/rest/v1/stats?key=eq.total_executions`, { headers });
            const data = await getRes.json();

            let totalExecutions = 1;
            if (data && data.length > 0) {
                totalExecutions = parseInt(data[0].value, 10) + 1;
                await fetch(`${SUPABASE_URL}/rest/v1/stats?key=eq.total_executions`, {
                    method: "PATCH",
                    headers,
                    body: JSON.stringify({ value: String(totalExecutions) })
                });
            } else {
                await fetch(`${SUPABASE_URL}/rest/v1/stats`, {
                    method: "POST",
                    headers,
                    body: JSON.stringify({ key: "total_executions", value: "1" })
                });
            }

            return jsonResponse({ success: true, totalExecutions });
        }

        // POST /api/manox/heartbeat
        if (method === "POST" && url.pathname === "/api/manox/heartbeat") {
            const { username } = await getBody();
            if (!username) return jsonResponse({ success: false }, 400);

            await fetch(`${SUPABASE_URL}/rest/v1/online_users?username=eq.${encodeURIComponent(username.trim())}`, {
                method: "PATCH",
                headers,
                body: JSON.stringify({ last_seen: now })
            });

            return jsonResponse({ success: true });
        }

        // GET /api/manox/users
        if (method === "GET" && url.pathname === "/api/manox/users") {
            const FIVE_MINUTES_AGO = now - (5 * 60 * 1000);

            const usersRes = await fetch(
                `${SUPABASE_URL}/rest/v1/online_users?last_seen=gt.${FIVE_MINUTES_AGO}&order=last_seen.desc&limit=100000`,
                { headers }
            );
            const activeUsersData = await usersRes.json();
            const activeList = Array.isArray(activeUsersData) ? activeUsersData.map(u => u.username) : [];

            const statsRes = await fetch(`${SUPABASE_URL}/rest/v1/stats?key=eq.total_executions`, { headers });
            const statsData = await statsRes.json();
            const totalExecutions = (statsData && statsData.length > 0) ? parseInt(statsData[0].value, 10) : 0;

            return jsonResponse({
                success: true,
                onlineCount: activeList.length,
                users: activeList,
                totalExecutions
            });
        }

        // --- DADOS DO USUÁRIO ROBLOX ---
if (method === "GET" && url.pathname === "/api/manox/roblox-user") {
    const username = url.searchParams.get("username");

    if (!username || !username.trim()) {
        return jsonResponse({
            success: false,
            message: "Username necessário."
        }, 400);
    }

    try {
        const robloxRes = await fetch(
            "https://users.roblox.com/v1/usernames/users",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    usernames: [username.trim()],
                    excludeBannedUsers: false
                })
            }
        );

        if (!robloxRes.ok) {
            return jsonResponse({
                success: false,
                message: "Erro ao consultar o Roblox.",
                status: robloxRes.status
            }, 502);
        }

        const robloxData = await robloxRes.json();

        if (
            !robloxData ||
            !Array.isArray(robloxData.data) ||
            robloxData.data.length === 0
        ) {
            return jsonResponse({
                success: true,
                exists: false,
                username: username.trim(),
                userId: null,
                displayName: null,
                avatar: null
            });
        }

        const user = robloxData.data[0];

        let avatar = null;

        try {
            const thumbnailRes = await fetch(
                `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${user.id}&size=150x150&format=Png&isCircular=true`
            );

            if (thumbnailRes.ok) {
                const thumbnailData = await thumbnailRes.json();

                if (
                    thumbnailData &&
                    Array.isArray(thumbnailData.data) &&
                    thumbnailData.data.length > 0
                ) {
                    avatar = thumbnailData.data[0].imageUrl || null;
                }
            }
        } catch (thumbnailError) {
            console.error("Erro ao obter avatar:", thumbnailError);
        }

        return jsonResponse({
            success: true,
            exists: true,

            username: user.name,
            displayName: user.displayName,
            userId: user.id,

            avatar: avatar,

            profileUrl: `https://www.roblox.com/users/${user.id}/profile`
        });

    } catch (error) {
        console.error("Erro Roblox:", error);

        return jsonResponse({
            success: false,
            message: "Não foi possível consultar o Roblox."
        }, 500);
    }
}

// 1. ENVIAR LOG (POST)
if (method === "POST" && url.pathname === "/api/manox/logs/send") {
    const body = await getBody();
    const { username, userId, executor, gameName, placeId, jobId, hubName } = body;

    if (!username || !userId) {
        return jsonResponse({ success: false, message: "Campos obrigatórios ausentes." }, 400);
    }

    const logData = {
        username: username.trim(),
        user_id: String(userId),
        executor: executor ? executor.trim() : "Desconhecido",
        game_name: gameName ? gameName.trim() : "Jogo Desconhecido",
        place_id: String(placeId || ""),
        job_id: String(jobId || ""),
        hub_name: hubName ? hubName.trim() : "Manox Hub",
        created_at: now
    };

    const res = await fetch(`${SUPABASE_URL}/rest/v1/user_logs`, {
        method: "POST",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify(logData)
    });

    if (!res.ok) {
        return jsonResponse({ success: false, message: "Erro ao salvar log no banco de dados." }, 500);
    }

    return jsonResponse({ success: true, message: "Log registrado com sucesso!" }, 201);
}

// 2. RECEBER/LISTAR LOGS (GET)
if (method === "GET" && url.pathname === "/api/manox/logs") {
    const limit = url.searchParams.get("limit") || "50";
    
    const res = await fetch(
        `${SUPABASE_URL}/rest/v1/user_logs?select=*&order=created_at.desc&limit=${limit}`,
        { headers }
    );

    const logs = await res.json();

    return jsonResponse({
        success: true,
        logs: Array.isArray(logs) ? logs : []
    });
}

// 3. LIMPAR LOGS (POST - Opcional)
if (method === "POST" && url.pathname === "/api/manox/logs/clear") {
    if (!checkAdminKey()) return jsonResponse({ success: false, message: "Não autorizado" }, 401);

    await fetch(`${SUPABASE_URL}/rest/v1/user_logs?id=gt.0`, {
        method: "DELETE",
        headers
    });

    return jsonResponse({ success: true, message: "Todos os logs foram apagados." });
}

// 1. ALTERAR VISIBILIDADE DA TAG (POST)
if (method === "POST" && url.pathname === "/api/manox/user/tag-visibility-set") {
    if (!checkAdminKey()) return jsonResponse({ success: false, message: "Não autorizado" }, 401);

    const { username, visible } = await getBody();

    if (!username || typeof visible !== "boolean") {
        return jsonResponse({ success: false, message: "Parâmetros 'username' e 'visible' (boolean) são obrigatórios." }, 400);
    }

    // Atualiza a preferência no Supabase
    const res = await fetch(`${SUPABASE_URL}/rest/v1/user_logs?username=eq.${encodeURIComponent(username.trim())}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ tag_visible: visible })
    });

    if (!res.ok) {
        return jsonResponse({ success: false, message: "Erro ao atualizar no banco de dados." }, 500);
    }

    return jsonResponse({ 
        success: true, 
        username: username.trim(), 
        tagVisible: visible 
    });
}

// 2. CONSULTAR VISIBILIDADE DA TAG (GET)
if (method === "GET" && url.pathname === "/api/manox/user/tag-visibility") {
    const username = url.searchParams.get("username");

    if (!username) {
        return jsonResponse({ success: false, message: "Parâmetro 'username' é obrigatório." }, 400);
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/user_logs?username=eq.${encodeURIComponent(username.trim())}&select=tag_visible&limit=1`, { headers });
    const data = await res.json();

    if (Array.isArray(data) && data.length > 0) {
        const isVisible = data[0].tag_visible !== false; // Se for null ou undefined, padrão é true
        return jsonResponse({ 
            success: true, 
            username: username.trim(), 
            tagVisible: isVisible 
        });
    }

    // Se o usuário ainda não tiver registro, retorna o padrão (true)
    return jsonResponse({ 
        success: true, 
        username: username.trim(), 
        tagVisible: true 
    });
}

// 1. CONSULTAR VERSÃO ATUAL DO HUB (GET)
if (method === "GET" && url.pathname === "/api/manox/version") {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/hub_version?id=eq.1&select=version,updated_at`, { headers });
    const data = await res.json();

    if (Array.isArray(data) && data.length > 0) {
        return jsonResponse({ success: true, version: data[0].version, updatedAt: data[0].updated_at });
    }

    return jsonResponse({ success: true, version: "4.4.1", updatedAt: now });
}

// 2. ATUALIZAR / INCREMENTAR VERSÃO DO HUB (POST)
if (method === "POST" && url.pathname === "/api/manox/version/update") {
    if (!checkAdminKey()) return jsonResponse({ success: false, message: "Não autorizado" }, 401);

    const { type, manualVersion } = await getBody();

    // Busca a versão atual do banco
    const currentRes = await fetch(`${SUPABASE_URL}/rest/v1/hub_version?id=eq.1&select=version`, { headers });
    const currentData = await currentRes.json();
    let currentVersion = (Array.isArray(currentData) && currentData.length > 0) ? currentData[0].version : "4.4.1";

    let newVersion = currentVersion;

    if (manualVersion) {
        // Se enviou uma versão específica (ex: "5.0.0")
        newVersion = manualVersion.trim();
    } else if (type) {
        // Separa os números da versão atual [MAJOR, MINOR, PATCH]
        let parts = currentVersion.split('.').map(num => parseInt(num, 10) || 0);
        if (parts.length < 3) parts = [4, 4, 1];

        if (type === "patch") {
            // Bugs corrigidos (+0.0.1) -> 4.4.1 vira 4.4.2
            parts[2] += 1;
        } else if (type === "minor") {
            // Atualização (+0.1.0) -> 4.4.1 vira 4.5.0
            parts[1] += 1;
            parts[2] = 0;
        } else if (type === "major") {
            // Atualização grande (+1.0.0) -> 4.4.1 vira 5.0.0
            parts[0] += 1;
            parts[1] = 0;
            parts[2] = 0;
        } else {
            return jsonResponse({ success: false, message: "Tipo inválido. Use 'patch', 'minor' ou 'major'." }, 400);
        }

        newVersion = parts.join('.');
    } else {
        return jsonResponse({ success: false, message: "Forneça o 'type' ('patch', 'minor', 'major') ou 'manualVersion'." }, 400);
    }

    // Salva a nova versão no Supabase
    const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/hub_version`, {
        method: "POST",
        headers: { 
            ...headers, 
            "Prefer": "resolution=merge-duplicates,return=representation" 
        },
        body: JSON.stringify({ 
            id: 1, 
            version: newVersion, 
            updated_at: now 
        })
    });

    if (!updateRes.ok) {
        const errText = await updateRes.text();
        return jsonResponse({ success: false, message: "Erro ao atualizar versão no banco.", details: errText }, 500);
    }

    return jsonResponse({ 
        success: true, 
        oldVersion: currentVersion, 
        newVersion: newVersion, 
        updatedAt: now 
    });
}
    
        return jsonResponse({ success: false, message: "Rota não encontrada" }, 404);
    }
};

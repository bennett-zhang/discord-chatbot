const superagent = require("superagent")
const md5 = require("md5")

let cookies

module.exports = async (stimulus, context = []) => {
    if (!cookies) {
        const req = await superagent.get("https://www.cleverbot.com")
        cookies = req.header["set-cookie"]
    }

    let payload = `stimulus=${sanitizeInput(stimulus)}&`

    const reverseContext = [...context].reverse()

    for (let i = 0; i < context.length; i++) {
        payload += `vText${i + 2}=${sanitizeInput(reverseContext[i])}&`
    }
    
    payload += "cb_settings_scripting=no&cb_settings_emotion=yes&islearning=1&icognoid=wsf&icognocheck="

    payload += md5(payload.substring(7, 33))

    const req = await superagent.post("https://www.cleverbot.com/webservicemin?uc=UseOfficialCleverbotAPI")
        .set("Cookie", cookies)
        .type("text/plain")
        .send(payload)

    const reactEmoteMatch = req.text.match(/^{r,([^,]+),([^}]+)}{e,([^,]+),([^}]+)}(.*)$/m)

    const res = {
        reply: decodeURIComponent(req.header["cboutput"])
    }

    if (reactEmoteMatch) {
        res.reaction = reactEmoteMatch[1],
        res.reactionDegree = reactEmoteMatch[2],
        res.emotion = reactEmoteMatch[3],
        res.emotionDegree = reactEmoteMatch[4]
    }

    return res
}

function sanitizeInput(input) {
    let k = input.trim()
    if (k.length < 1) {
        return false
    }
    if (k === "{pass}") {
        return encodeForSending(k)
    }
    const g = k.charAt(0)
    const d = /[a-z]/i.test(g)
    const a = /[0-9a-zA-Z\u0400-\u04FF]/.test(k.substr(0, 2))
    const h = k.charAt(k.length - 1)
    if (g !== g.toUpperCase()) {
        k = g.toUpperCase() + k.substring(1)
    }
    if (d && ":;,-/".indexOf(h) > 0) {
        k = k.substring(0, k.length - 1) + "."
    } else {
        if (a && ".?!:;,".indexOf(h) < 0) {
            k += "."
        }
    }
    let l = false
    if (k.indexOf("\n") >= 0 || k.indexOf("\r") >= 0) {
        l = true
    }
    if (/<\/?[a-z]+>|<DOCTYPE/i.test(k)) {
        l = true
    }
    if (/<[^>]+>/g.test(k)) {
        l = true
    }
    if (l) {
        return false
    }
    return encodeForSending(k)
}

function encodeForSending(a) {
    let f = ""
    let d = ""
    a = a.replace(/[|]/g, "{*}")
    for (let b = 0; b <= a.length; b++) {
        if (a.charCodeAt(b) > 255) {
            d = escape(a.charAt(b))
            if (d.substring(0, 2) === "%u") {
                f += "|" + d.substring(2, d.length)
            } else {
                f += d
            }
        } else {
            f += a.charAt(b)
        }
    }
    f = f.replace("|201C", "'").replace("|201D", "'").replace("|2018", "'").replace("|2019", "'").replace("`", "'").replace("%B4", "'").replace("|FF20", "").replace("|FE6B", "")
    return escape(f)
}
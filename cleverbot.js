const superagent = require("superagent")
const md5 = require("md5")

let cookies

module.exports = async (stimulus, context = [], name) => {
  if (!cookies) {
    const req = await superagent.get("https://www.cleverbot.com")
    cookies = req.header["set-cookie"]
  }

  let payload = `stimulus=${encodeForSending(stimulus)}&`

  for (let i = 0; i < context.length; i++)
    payload += `vText${i + 2}=${encodeForSending(context[context.length - i - 1])}&`
  
  payload += "cb_settings_scripting=no&cb_settings_emotion=yes&islearning=1&icognoid=wsf&icognocheck="
  payload += md5(payload.substring(7, 33))

  const req = await superagent.post("https://www.cleverbot.com/webservicemin?uc=UseOfficialCleverbotAPI")
    .set("Cookie", cookies)
    .type("text/plain")
    .send(payload)
  
  let reply = decodeURIComponent(req.header["cboutput"])

  if (name)
    reply = reply.replace(/c.*?l.*?e.*?v.*?e.*?r.*?b.*?o.*?t/gi, name)

  const res = {reply}

  const reactEmoteMatch = req.text.match(/^{r,([^,]+),([^}]+)}{e,([^,]+),([^}]+)}(.*)$/m)
  if (reactEmoteMatch) {
    res.reaction = reactEmoteMatch[1],
    res.reactionDegree = reactEmoteMatch[2],
    res.emotion = reactEmoteMatch[3],
    res.emotionDegree = reactEmoteMatch[4]
  }

  return res
}

function encodeForSending(str) {
  let encodedStr = ""
  str = str.replace(/\|/g, "{*}")

  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) > 255)
      encodedStr += escape(str[i]).replace(/^%u/, "|")
    else
      encodedStr += str[i]
  }

  encodedStr = encodedStr.replace("|201C", "'").replace("|201D", "'").replace("|2018", "'").replace("|2019", "'").replace("`", "'").replace("%B4", "'").replace("|FF20", "").replace("|FE6B", "")
  return escape(encodedStr)
}
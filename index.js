const fs = require("fs")
const Discord = require("discord.js")
const discordClient = new Discord.Client()
const cleverbot = require("./cleverbot.js")
const speech = require("@google-cloud/speech")
const speechClient = new speech.SpeechClient()
const textToSpeech = require("@google-cloud/text-to-speech")
const ttsClient = new textToSpeech.TextToSpeechClient()
const {Readable} = require("stream")

// Google credentials for the usage of Google's speech engines
process.env["GOOGLE_APPLICATION_CREDENTIALS"] = "google-credentials.json"

// Silence for the bot to play
const SILENCE_FRAME = Buffer.from([0xF8, 0xFF, 0xFE])
class Silence extends Readable {
  _read() {
    this.push(SILENCE_FRAME)
  }
}

const chatHistory = {} // The history of messages each user has with the bot
const messagesPendingCount = {} // How many pending messages there are for each channel
const shouldQuote = {} // Whether or not to quote messages for each channel
let emotionsToEmoji

fs.readFile("params.json", "utf8", (err, data) => {
  if (err)
    throw err
  
  const params = JSON.parse(data)
  discordClient.login(params.token) // Login with the specified Discord bot token
})

fs.readFile("emotions.json", "utf8", (err, data) => {
  if (err)
    throw err
  
  emotionsToEmoji = JSON.parse(data)
})

discordClient.on("ready", () => {
  console.log(`Logged in as ${discordClient.user.tag}!`)
})

discordClient.on("message", async msg => {
  // Make sure the message isn't from a bot
  if (msg.author.bot)
    return

  // If the message was sent in a guild, make sure this bot was mentioned
  if (msg.guild && !msg.mentions.users.find(user => user.id === discordClient.user.id))
    return

  // Remove mentions from the message content
  msg.content = msg.content.replace(/<@.+?>|<#.+?>/g, "").trim()

  // Command the bot to listen in the same voice channel as the user
  if (msg.content.toLowerCase() === "/listen") {
    // Make sure the command was sent in a guild
    if (!msg.guild)
      return
    
    // Check the voice channel that the user is in
    const voiceChannel = msg.member.voice.channel
    if (!voiceChannel)
      return

    // Join the voice channel
    const connection = await voiceChannel.join()

    // Play silence (required for the bot to receive audio)
    connection.play(new Silence(), {type: "opus"})

    const chunks = {} // The sound data that the bot is receiving from each user
    connection.on("speaking", async (user, speaking) => {
      // If the user has begun speaking, and no other messages are pending
      if (speaking.has(Discord.Speaking.FLAGS.SPEAKING) && !messagesPendingCount[voiceChannel.id]) {
        // Initialize the chunks for this user
        if (!chunks[user.id])
          chunks[user.id] = []

        // Listen to this user and update their chunks
        const stream = connection.receiver.createStream(user, {mode: "pcm"})
        stream.on("data", chunk => chunks[user.id].push(chunk))
      }
      
      // If the user has finished speaking
      else if (chunks[user.id].length) {
        // This message is pending
        messagesPendingCount[voiceChannel.id] = ++messagesPendingCount[voiceChannel.id] || 1

        // Convert the chunks to Base64
        const audioBytes = Buffer.concat(chunks[user.id]).toString("base64")
        chunks[user.id] = []

        // Transcribe the audio data to text
        const transcription = (await speechClient.recognize({
          audio: {
            content: audioBytes
          },
          config: {
            encoding: "LINEAR16",
            sampleRateHertz: 44100,
            audioChannelCount: 2,
            languageCode: "en-US"
          }
        }))[0].results
          .map(result => result.alternatives[0].transcript)
          .join("\n")

        // This message is no longer pending
        messagesPendingCount[voiceChannel.id]--

        // Make sure something was said
        if (!transcription)
          return

        // Get the bot's reply to the message, and play it in the voice channel
        processMessage(new Discord.Message(discordClient, {
          author: user,
          content: transcription
        }, voiceChannel))
      }
    })

    return
  }

  // Get the bot's reply to the message, and send it to the text channel
  processMessage(msg)
})

async function processMessage(msg) {
  // Figure out if the channel is text or voice based
  const isTextChannel = msg.channel.type === "dm" || msg.channel.type === "text"
  const isVoiceChannel = msg.channel.type ===  "voice"

  // This message is pending
  messagesPendingCount[msg.channel.id] = ++messagesPendingCount[msg.channel.id] || 1

  if (isTextChannel)
    msg.channel.startTyping() // Start typing indicator

  // Address the message author by their nickname, if they have one
  const name = msg.guild ? msg.guild.member(msg.author).displayName : msg.author.username

  // Get the bot's response to the message
  const res = await cleverbot(msg.content, chatHistory[msg.author.id], name)
  
  let reply = ""

  if (isTextChannel) {
    // If there are multiple pending messages, quote the particular message
    // that the bot is responding to
    if (messagesPendingCount[msg.channel.id] > 1)
      shouldQuote[msg.channel.id] = true

    // Start the bot's reply with a block quote containing a copy of the message
    // that it is responding to
    if (shouldQuote[msg.channel.id])
      reply += `> ${msg.content.replace(/\n/g, "\n> ")}\n`

    // Tag the user that the bot is responding to before the reply
    reply += `<@${msg.author.id}> ${res.reply}`

    msg.channel.send(reply) // Send the bot's reply

    // React to the message using the bot's emotion
    if (emotionsToEmoji[res.emotion])
      msg.react(emotionsToEmoji[res.emotion])    
  } else if (isVoiceChannel) {
    // Address the user before the reply
    reply += `${name}, ${res.reply}`

    // Join the voice channel
    const connection = await msg.channel.join()

    // Convert the bot's reply to speech
    const audioContent = (await ttsClient.synthesizeSpeech({
      input: {text: reply},
      voice: {languageCode: "cmn-TW", name: "cmn-TW-Wavenet-A", ssmlGender: "FEMALE"},
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate: 1.15,
        pitch: 5
      }
    }))[0].audioContent

    // Play the speech in the voice channel
    const readable = new Readable()
    readable.push(audioContent)
    readable.push(null)
    connection.play(readable)
  }

  // If this is the first time this user has messaged the bot,
  // initialize the chat history for this user
  if (!chatHistory[msg.author.id])
    chatHistory[msg.author.id] = []
  
  // Add the message and response to the history
  chatHistory[msg.author.id].push(msg.content, res.reply)

  // This message is no longer pending
  messagesPendingCount[msg.channel.id]--

  if (isTextChannel) {
    // If all the messages in this channel have been processed,
    // we should no longer quote messages
    if (!messagesPendingCount[msg.channel.id])
      shouldQuote[msg.channel.id] = false
    
    msg.channel.stopTyping() // Stop the typing indicator
  }
}
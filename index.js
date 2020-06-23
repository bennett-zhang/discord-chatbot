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

const chatHistories = {} // The history of messages each user has with the bot
const messagesPendingCounts = {} // How many pending messages there are for each channel
const shouldQuote = {} // Whether or not to quote messages for each channel
const audioQueues = {} // The queue of audio that the bot is playing in each voice channel
const hotwordWasSpoken = {} // Whether or not each user in each voice channel has spoken a hotword
let botNames // The names that the bot will respond to
let hotwords // The phrases that the bot will respond to
let emotionsToEmoji // Maps possible bot emotions to their corresponding emojis

fs.readFile("params.json", "utf8", (err, data) => {
  if (err)
    throw err
  
  const params = JSON.parse(data)

  // List of greetings that the bot will respond to
  // Remove non-letter, apostrophe, and space characters
  const greetings = params.greetings.map(greeting => greeting.replace(/[^A-Za-z' ]/g, ""))

  // List of names that the bot will respond to
  // Remove non-letter, apostrophe, and space characters
  botNames = params.names.map(name => name.replace(/[^A-Za-z' ]/g, ""))

  // The hotwords are every combination of greeting + name
  hotwords = [...botNames]
  for (const greeting of greetings) {
    for (const name of botNames)
      hotwords.push(`${greeting} ${name}`)
  }

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
  if (msg.guild && !msg.mentions.users.find(user => user.id === discordClient.user.id) &&
      !msg.mentions.roles.intersect(msg.guild.member(discordClient.user).roles.cache).size)
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

    // Keep track of the users that have said a hotword in this voice channel
    hotwordWasSpoken[voiceChannel.id] = {}

    // Initialize the audio queue for this voice channel
    audioQueues[voiceChannel.id] = []

    const chunks = {} // The sound data that the bot is receiving from each user
    connection.on("speaking", async (user, speaking) => {
      // If the user has begun speaking
      if (speaking.has(Discord.Speaking.FLAGS.SPEAKING)) {
        // Initialize the chunks for this user
        if (!chunks[user.id])
          chunks[user.id] = []

        // Listen to this user and update their chunks
        const stream = connection.receiver.createStream(user, {mode: "pcm"})
        stream.on("data", chunk => chunks[user.id].push(chunk))
      }
      
      // If the user has finished speaking
      else if (chunks[user.id] && chunks[user.id].length) {
        // Convert the chunks to Base64
        const audioBytes = Buffer.concat(chunks[user.id]).toString("base64")
        chunks[user.id] = []

        // Transcribe the audio data to text
        let transcription = (await speechClient.recognize({
          audio: {
            content: audioBytes
          },
          config: {
            encoding: "LINEAR16",
            sampleRateHertz: 44100,
            audioChannelCount: 2,
            languageCode: "en-US",
            //alternativeLanguageCodes: ["vi-VN"],
            speechContexts: [{
              phrases: hotwords,
              boost: 20
            }]
          }
        }))[0].results
          .map(result => result.alternatives[0].transcript)
          .join("\n")
        
        // If a hotword was spoken
        if (transcription.trim().match(new RegExp(`^(${hotwords.join("|")})$`, "i"))) {
          // Play a sound prompting the user to speak
          connection.play("ready.wav")

          // Remember that this user has spoken a hotword
          hotwordWasSpoken[voiceChannel.id][user.id] = true
          return
        }

        // Make sure this user just spoke a hotword
        if (!hotwordWasSpoken[voiceChannel.id][user.id])
          return

        // Remove the bot's name from the transcription
        transcription = transcription.replace(new RegExp(botNames.join("|"), "gi"), "").trim()

        // Make sure something was said
        if (!transcription)
          return
        
        console.log(transcription)

        // This user's hotword is no longer active
        hotwordWasSpoken[voiceChannel.id][user.id] = false
        
        // Get the bot's reply to the message, and play it in the voice channel
        processMessage(new Discord.Message(discordClient, {
          author: user,
          content: transcription
        }, voiceChannel), connection)
      }
    })

    return
  }

  // Get the bot's reply to the message, and send it to the text channel
  processMessage(msg)
})

async function processMessage(msg, connection) {
  // Figure out if the channel is text or voice based
  const isTextChannel = msg.channel.type === "dm" || msg.channel.type === "text"
  const isVoiceChannel = msg.channel.type ===  "voice"

  // This message is pending
  messagesPendingCounts[msg.channel.id] = ++messagesPendingCounts[msg.channel.id] || 1

  if (isTextChannel)
    msg.channel.startTyping() // Start typing indicator

  // Address the message author by their nickname, if they have one
  const name = msg.guild ? msg.guild.member(msg.author).displayName : msg.author.username

  // Get the bot's response to the message
  const res = await cleverbot(msg.content, chatHistories[msg.author.id], name)
  
  let reply = ""

  if (isTextChannel) {
    // If there are multiple pending messages, quote the particular message
    // that the bot is responding to
    if (messagesPendingCounts[msg.channel.id] > 1)
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

    // Convert the bot's reply to speech
    const audioContent = (await ttsClient.synthesizeSpeech({
      input: {text: reply},
      voice: {languageCode: "cmn-TW", name: "cmn-TW-Wavenet-A", ssmlGender: "FEMALE"},
      //voice: {languageCode: "vi-VN", name: "vi-VN-Wavenet-A", ssmlGender: "FEMALE"},
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate: 1.15,
        pitch: 5
      }
    }))[0].audioContent

    // Create a readable stream containing the audio data
    const readable = new Readable()
    readable.push(audioContent)
    readable.push(null)

    // Add the audio stream to the queue
    audioQueues[msg.channel.id].push(readable)
    
    // If there's only one stream in the queue, play it
    if (audioQueues[msg.channel.id].length === 1)
      playNextStream(msg.channel, connection)
  }

  // If this is the first time this user has messaged the bot,
  // initialize the chat history for this user
  if (!chatHistories[msg.author.id])
    chatHistories[msg.author.id] = []
  
  // Add the message and response to the history
  chatHistories[msg.author.id].push(msg.content, res.reply)

  // This message is no longer pending
  messagesPendingCounts[msg.channel.id]--

  if (isTextChannel) {
    // If all the messages in this channel have been processed,
    // we should no longer quote messages
    if (!messagesPendingCounts[msg.channel.id])
      shouldQuote[msg.channel.id] = false
    
    msg.channel.stopTyping() // Stop the typing indicator
  }
}

// Play the next stream in the queue
async function playNextStream(voiceChannel, connection) {
  // If there exists a stream in the queue
  if (audioQueues[voiceChannel.id] && audioQueues[voiceChannel.id].length) {
    // Play the first stream in the queue
    connection.play(audioQueues[voiceChannel.id][0])

    // When the stream finishes playing,
    // remove it from the queue and play the next one
    connection.dispatcher.on("finish", () => {
      audioQueues[voiceChannel.id].shift()
      playNextStream(voiceChannel, connection)
    })
  }
}
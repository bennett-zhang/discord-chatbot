const fs = require("fs")
const Discord = require("discord.js")
const discordClient = new Discord.Client()
const cleverbot = require("./cleverbot.js")
const speech = require("@google-cloud/speech")
const sttClient = new speech.SpeechClient()
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
let botNames // The names that the bot will respond to
let hotwords // The phrases that the bot will respond to
let emotionsToEmoji // Maps possible bot emotions to their corresponding emojis

// The request sent to Google's speech-to-text service
const sttRequest = {
  config: {
    encoding: "LINEAR16",
    sampleRateHertz: 48000,
    audioChannelCount: 2,
    languageCode: "en-US",
    //alternativeLanguageCodes: ["vi-VN"],
    speechContexts: [{
      phrases: null,
      boost: 20
    }]
  }
}

// The request sent to Google's text-to-speech service
const ttsRequest = {
  input: {text: null},
  voice: {languageCode: "cmn-TW", name: "cmn-TW-Wavenet-A", ssmlGender: "FEMALE"},
  //voice: {languageCode: "vi-VN", name: "vi-VN-Wavenet-A", ssmlGender: "FEMALE"},
  audioConfig: {
    audioEncoding: "OGG_OPUS",//"LINEAR16",
    speakingRate: 1.15,
    pitch: 5
  }
}

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

  // Increase the likelihood that speech-to-text will recognize the hotwords
  sttRequest.config.speechContexts[0].phrases = hotwords

  discordClient.login(params.token) // Login with the specified Discord bot token
})

fs.readFile("emotions.json", "utf8", (err, data) => {
  if (err)
    throw err
  
  emotionsToEmoji = JSON.parse(data)
})

discordClient.on("ready", () => {
  console.log(`Logged in as ${discordClient.user.tag}!`)

  // Start listening in every voice channel that the bot is apart of
  discordClient.guilds.cache.each(guild => {
    listenInVoiceChannel(guild.member(discordClient.user).voice.channel)
  })
})

discordClient.on("message", msg => {
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
  if (msg.content.toLowerCase() === "/join") {
    // Make sure the command was sent in a guild
    if (!msg.guild)
      return
        
    // Join and listen in the user's voice channel
    listenInVoiceChannel(msg.member.voice.channel)
    return
  }

  // Get the bot's reply to the message, and send it to the text channel
  processMessage(msg)
})

async function listenInVoiceChannel(voiceChannel) {
  // Make sure the voice channel exists
  if (!voiceChannel)
    return

  // Join the voice channel
  const connection = await voiceChannel.join()

  // Make sure the bot isn't already listening
  if (connection.listeners("speaking").length)
    return

  // Play silence (required for the bot to receive audio)
  connection.play(new Silence(), {type: "opus"})

  // Initialize the audio queue for this voice channel
  audioQueues[voiceChannel.id] = []

  // The voice recognition streams for each user
  const recognizeStreams = {}

  // Keep track of the users that have said a hotword in this voice channel
  const hotwordWasSpoken = {}

  connection.on("speaking", (user, speaking) => {
    // If the user has begun speaking
    if (speaking.has(Discord.Speaking.FLAGS.SPEAKING)) {
      // Listen to this user
      const stream = connection.receiver.createStream(user, {mode: "pcm"})

      // Initialize the recognition streams for this user
      recognizeStreams[user.id] = sttClient.streamingRecognize(sttRequest)
        .on("error", console.error)
        .on("data", data => {
          sttCallback(user, data)
        })

      stream.pipe(recognizeStreams[user.id])
    }
  })

  function sttCallback(user, data) {
    // Transcribe the audio data to text
    let transcription = data.results
      .map(result => result.alternatives[0].transcript)
      .join("\n")
      .trim()

    console.log(transcription)
        
    // If the bot isn't currently talking and a hotword was spoken
    if (!audioQueues[voiceChannel.id].length && transcription.match(new RegExp(`^(${hotwords.join("|")})$`, "i"))) {
      // Play a sound prompting the user to speak
      connection.play(fs.createReadStream("begin.ogg"), {
        type: "ogg/opus",
        highWaterMark: 50
      })

      // Remember that this user has spoken a hotword
      hotwordWasSpoken[user.id] = true
      return
    }

    // Make sure this user just spoke a hotword
    if (!hotwordWasSpoken[user.id])
      return

    // Remove the bot's name from the transcription
    transcription = transcription.replace(new RegExp(botNames.join("|"), "gi"), "").trim()

    // Make sure something was said
    if (!transcription)
      return

    // If the bot isn't currently talking
    if (!audioQueues[voiceChannel.id].length) {
      // Play a sound confirming that the user was heard
      connection.play(fs.createReadStream("confirm.ogg"), {
        type: "ogg/opus",
        highWaterMark: 50
      })
    }

    // This user's hotword is no longer active
    hotwordWasSpoken[user.id] = false

    // Get the bot's reply to the message, and play it in the voice channel
    processMessage(new Discord.Message(discordClient, {
      author: user,
      content: transcription
    }, voiceChannel), connection)
  }
}

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
    ttsRequest.input.text = reply
    const audioContent = (await ttsClient.synthesizeSpeech(ttsRequest))[0].audioContent

    //fs.writeFile("output.wav", audioContent, "binary", () => {})

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
function playNextStream(voiceChannel, connection) {
  // If there exists a stream in the queue
  if (audioQueues[voiceChannel.id] && audioQueues[voiceChannel.id].length) {
    // Play the first stream in the queue
    connection.play(audioQueues[voiceChannel.id][0], {
      type: "ogg/opus"
    })

    // When the stream finishes playing,
    // remove it from the queue and play the next one
    connection.dispatcher.on("finish", () => {
      audioQueues[voiceChannel.id].shift()
      playNextStream(voiceChannel, connection)
    })
  }
}
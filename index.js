const fs = require("fs")
const Discord = require("discord.js")
const client = new Discord.Client()
const cleverbot = require("./cleverbot.js")

const messageQueue = [] // A queue containing the messages that the bot will reply to
const chatHistory = {} // The history of messages with the bot for each user
let emotionsToEmoji

fs.readFile("params.json", "utf8", (err, data) => {
  if (err)
    throw err
  
  const params = JSON.parse(data)
  client.login(params.token) // Login with the specified Discord bot token
})

fs.readFile("emotions.json", "utf8", (err, data) => {
  if (err)
    throw err
  
  emotionsToEmoji = JSON.parse(data)
})

client.on("ready", () => {
  console.log(`Logged in as ${client.user.tag}!`)
})

client.on("message", msg => {
  // Make sure the message isn't from the bot
  if (msg.author.id === client.user.id)
    return

  messageQueue.push(msg) // Add the message to the queue

  // If this is the first time this user has messaged the bot,
  // initialize the chat history for this user
  if (!chatHistory[msg.author.id])
    chatHistory[msg.author.id] = []

  // Don't process the message unless it's the only one in the queue
  if (messageQueue.length > 1)
    return

  msg.channel.startTyping() // Start typing indicator

  // Get the bot's response to the message, then process the response
  cleverbot(msg.content, chatHistory[msg.author.id]).then(processResponse)
  
  // Whether or not the bot should quote the message that it's responding to
  let quoteMessage = false

  function processResponse(res) {
    let reply = ""

    // If there's multiple messages in the queue, quote the particular message
    // that the bot is responding to
    if (messageQueue.length > 1)
      quoteMessage = true

    // Start the bot's reply with a block quote containing a copy of the message
    // that it is responding to
    if (quoteMessage)
      reply += `> ${msg.content.replace(/\n/g, "\n> ")}\n`

    // Tag the user that the bot is responding to
    reply += `<@${msg.author.id}>, `

    // Replace instances of "Cleverbot" in the response with the user's name
    reply += res.reply.replace(/c.*?l.*?e.*?v.*?e.*?r.*?b.*?o.*?t/gi, msg.author.username)

    msg.channel.send(reply) // Send the bot's reply

    // Convert the bot's emotion to an emoji
    const emoji = emotionsToEmoji[res.emotion]

    // React to the message
    if (emoji)
      msg.react(emoji)
    
    messageQueue.shift() // Dequeue

    // Add the message and response to the history
    chatHistory[msg.author.id].push(msg.content)
    chatHistory[msg.author.id].push(res.reply)

    // If there are still more messages in the queue
    if (messageQueue.length) {
      msg = messageQueue[0]

      // Get the bot's response to the next message in the queue, and process that response
      cleverbot(msg.content).then(processResponse)
    } else
      msg.channel.stopTyping() // Stop the typing indicator
  }
})
const Discord = require("discord.js")
const bot = new Discord.Client()
const puppeteer = require("puppeteer")

const NAME = "BMO" // The name of the bot
const BOT_TOKEN = "NjIxMzkwNDkwMTAwODI2MTIy.XXk4YQ.QMO48umHUhq8pLv0ceFxDqStLNc" // The Discord bot token

const messageQueue = [] // A queue containing the messages that the bot will reply to

bot.login(BOT_TOKEN)

bot.on("ready", () => {
  console.log(`Logged in as ${bot.user.tag}!`)
})

// Launch an instance of a headless Chrome browser
puppeteer.launch().then(async browser => {
  const page = await browser.newPage()
  await page.goto("https://www.cleverbot.com")

  await page.evaluate(() => {
    cleverbot.betweenrequests = 0 // No delay between API calls
    cleverbot.withreactions = true // Process bot emotions and reactions
    cleverbot.inputValidate = () => cleverbot.stimuluselement.value // Don't validate input
    cleverbot.processAIOrig = cleverbot.processAI // Make a copy of the processAI function
  })

  await new Promise((resolve, reject) => {
    // Whenever the bot receives a message
    bot.on("message", msg => {
      // Make sure the message isn't from the bot
      if (msg.author.id !== bot.user.id) {
        messageQueue.push(msg) // Add the message to the queue

        msg.channel.startTyping() // Start typing indicator

        // If there's only one message in the queue
        if (messageQueue.length === 1) {
          // Get the bot's response to the message, then process the response
          getCleverbotResponse(msg.content).then(processResponse)
          
          // Whether or not the bot should quote the message that it's responding to
          let quoteMessage = false

          function processResponse(response) {
            let reply = ""
            
            /*
            If there's multiple messages in the queue, quote the particular message
            that the bot is responding to
            */
            if (messageQueue.length > 1)
              quoteMessage = true
            
            /*
            Start the bot's reply with a block quote containing a copy of the message
            that it is responding to
            */
            if (quoteMessage) {
              reply += "> "

              for (let i = 0; i < msg.content.length; i++) {
                reply += msg.content[i]

                if (msg.content[i] === "\n")
                  reply += "> "
              }
            }

            // Tag the user that the bot is responding to, and include the bot's reply
            reply += "\n<@" + msg.author.id + ">, " + replaceName(response.reply, "Cleverbot", NAME)

            // Send the bot's reply
            msg.channel.send(reply)
            
            // Convert the bot's emotion to an emoji
            const emoji = emotionToEmoji(response.emotion)

            // React to the message with the emoji corresponding with the bot's emotion
            if (emoji)
              msg.react(emoji)
            
            msg.channel.stopTyping() // Stop the typing indicator
            messageQueue.shift() // Dequeue

            // If there are still more messages in the queue
            if (messageQueue.length) {
              msg = messageQueue[0]

              // Get the bot's response to the next message in the queue, and process that response
              getCleverbotResponse(msg.content).then(processResponse)
            }
          }
        }
      }
    })
  })

  // Returns the bot's response to an input message
  function getCleverbotResponse(input) {
    return page.evaluate(input => {
      try {
        // Set the value of the textbox to the input message
        cleverbot.stimuluselement.value = input

        cleverbot.sendAI()
        
        return new Promise((resolve, reject) => {
          cleverbot.processAI = (l, k, d) => {
            // Process the AI and get its response
            cleverbot.processAIOrig(l, k, d)

            // After the AI has finished processing, return its reply and emotion
            resolve({
              reply: cleverbot.reply,
              emotion: cleverbot.emotion
            })
          }
        })
      } catch(err) {
        throw err.toString()
      }
    }, input).catch(err => {
      console.error(err)
      process.exit()
    })
  }

  await browser.close() // Close the browser
  process.exit()
})

/*
Replaces every instance of origName in a string with newName.
Takes into consideration potential typos of origName, such as extra
spaces or symbols in between characters and repeated characters.
origName is not case sensitive.
*/
function replaceName(string, origName, newName) {
  origName = origName.toLowerCase()

  /*
  As more and more characters of origName are found in the specified string,
  this index will increment
  */
  let indexInOrigName = -1

  // The index in the specified string that origName was found
  let startIndexOfOrigName = 0

  // Loop through the specified string
  for (let i = 0; i < string.length; i++) {
    const char = string[i].toLowerCase()

    // If the character in the specified string matches the next character in origName
    if (char === origName[indexInOrigName + 1])
      indexInOrigName++ // Move to the next character in origName
    
    /*
    If the character in the specified string is a letter, and it neither matches the
    current nor the next character in origName
    */
    else if (indexInOrigName >= 0 && char !== origName[indexInOrigName] && char >= "a" && char <= "z") {
      indexInOrigName = -1 // origName was not found, so reset the index to -1

      // If the character in the specified string matches the first character of origName
      if (char === origName[0]) {
        indexInOrigName = 0
        startIndexOfOrigName = i
      }
    }

    // If every character of origName was found
    if (indexInOrigName === origName.length - 1) {
      string = string.slice(0, startIndexOfOrigName) + newName + string.slice(i + 1)
      i = startIndexOfOrigName - 1 + newName.length
      indexInOrigName = -1
    }
  }

  return string
}

// Converts an emotion to an emoji
function emotionToEmoji(emotion) {
  switch (emotion.trim().toLowerCase()) {
    case "agreeable":
      return "😊"
    case "alert":
      return "❗"
    case "amused":
      return "😂"
    case "angry":
      return "😠"
    case "apologetic":
      return "🙇"
    case "argumentative":
      return "👊"
    case "assertive":
      return "😤"
    case "bored":
      return "🙄"
    case "calm":
      return "😌"
    case "concerned":
      return "😟"
    case "contemplative":
      return "🤔"
    case "curious":
      return "😯"
    case "dancing":
      return "💃"
    case "determined":
      return "😣"
    case "devious":
      return "😈"
    case "didactic":
      return "🤓"
    case "distracted":
      return "😵"
    case "doubting":
      return "🤔"
    case "excited":
      return "😆"
    case "flirty":
      return "😏"
    case "forgetful":
      return "😵"
    case "furious":
      return "😡"
    case "gentle":
      return "🐇"
    case "grumpy":
      return "😒"
    case "guilty":
      return "😳"
    case "happy":
      return "😀"
    case "hatred":
      return "👿"
    case "joking":
      return "🙃"
    case "jumpy":
      return "😨"
    case "lazy":
      return "😴"
    case "love":
      return "😍"
    case "mean":
      return "😠"
    case "mocking":
      return "😜"
    case "modest":
      return "🙂"
    case "naughty":
      return "🍆"
    case "negative":
      return "👎"
    case "nice":
      return "🙂"
    case "none":
      return "😶"
    case "nosey":
      return "🔎"
    case "positive":
      return "👍"
    case "proud":
      return "💪"
    case "questioning":
      return "❓"
    case "relaxed":
      return "😌"
    case "reluctant":
      return "😕"
    case "righteous":
      return "😇"
    case "robotic":
      return "🤖"
    case "rude":
      return "🖕"
    case "sad":
      return "😢"
    case "sarcastic":
      return "🙄"
    case "serious":
      return "😐"
    case "shouting":
      return "📢"
    case "shy":
      return "😳"
    case "silly":
      return "🙃"
    case "singing":
      return "🎶"
    case "sleepy":
      return "😴"
    case "smug":
      return "😏"
    case "stubborn":
      return "😑"
    case "supportive":
      return "🤗"
    case "sure":
      return "👌"
    case "sweetness":
      return "😙"
    case "sympathy":
      return "🤗"
    case "thoughtful":
      return "🤔"
    case "tired":
      return "😫"
    case "tongue out":
      return "😛"
    case "uncomfortable":
      return "😬"
    case "unsure":
      return "🤷"
    case "very happy":
      return "😄"
    case "very sad":
      return "😭"
    case "victorious":
      return "🙌"
    case "winking":
      return "😉"
    case "worried":
      return "😟"
    default:
      return ""
  }
}
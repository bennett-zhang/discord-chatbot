# discord-chatbot

A chatbot for Discord that uses artifical intelligence to reply and react to messages.

You will need to create a file called "params.json" in the main directory containing the following:

```
{
  "greetings": ["Hey", "Hi", "Hello"], // List of greetings that the bot will respond to
  "names": ["Billy", "Jones"],         // List of names that the bot will respond to
  "token": "..."                       // Your Discord bot token
}
```

You will also need a file called "google-credentials.json" to use Google Cloud's speech services.
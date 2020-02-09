# Rotel Amplifier Homebridge Plugin

## Introduction

This repository contains a Homebridge plugin, which I use to control my Rotel
RA-1570 amplifier through Homekit (e.g., "Hey Siri, turn off Amplifier"). The
amplifier itself only has a serial port interface, and I had previously written
`rotel-server.rb`, which listens for commands and queries over TCP, and talks
with the amplifier over a serial port. The [amplifier control
server](https://github.com/arkku/amplifier-control) is available in a separate
repository.

So, this plugin only works with my specific server (although it would not be
too hard to change the underlying `rotel.rb` to speak a different RS-232
protocol), and as such I don't expect it to be particularly useful for anyone
other than myself as is. It does show how to make a Homebridge platform
accessory, but other than that my JavaScript coding style is horrible
spaghetti and does not set a good example. (In my defense, I used another
Homebridge plugin as an example, since I don't really know Node.js myself).

~ [Kimmo Kulovesi](https://arkku.dev/), 2020-02-09


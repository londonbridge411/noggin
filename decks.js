// Built-in decks, exposed as window.DECKS. A card is { text, img }: text is the answer, img is an optional image URL.
// Name decks are plain word lists; picture decks pair an answer with an image URL.

(function () {
const names = (list) => list.map((text) => ({ text }));

const wiki = (file) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=640`;

// Twemoji file names are the emoji's code points in hex, joined with dashes.
const emoji = (ch) =>
  `https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg/${[...ch]
    .map((c) => c.codePointAt(0).toString(16))
    .filter((cp) => cp !== 'fe0f')
    .join('-')}.svg`;

const DECKS = {
  animals: {
    name: 'Animals',
    kind: 'names',
    cards: names([
      'Elephant', 'Penguin', 'Kangaroo', 'Octopus', 'Giraffe', 'Platypus', 'Sloth', 'Flamingo',
      'Hedgehog', 'Shark', 'Owl', 'Chameleon', 'Raccoon', 'Peacock', 'Jellyfish', 'Gorilla',
      'Armadillo', 'Narwhal', 'Koala', 'Squirrel', 'Bat', 'Crocodile', 'Hamster', 'Panda',
      'Woodpecker', 'Camel', 'Skunk', 'Lobster', 'Zebra', 'Moose', 'Seahorse', 'Hippo',
      'Llama', 'Bald Eagle', 'Goldfish', 'Tarantula', 'Polar Bear', 'Otter', 'Snail', 'Walrus',
    ]),
  },
  food: {
    name: 'Food & Drink',
    kind: 'names',
    cards: names([
      'Pizza', 'Sushi', 'Spaghetti', 'Pancakes', 'Taco', 'Popcorn', 'Cotton Candy', 'Hot Dog',
      'Ice Cream Sundae', 'Pineapple', 'Burrito', 'Lasagna', 'Croissant', 'Corn on the Cob',
      'Birthday Cake', 'Pretzel', 'Smoothie', 'Fried Chicken', 'Waffles', 'Watermelon',
      'Ramen', 'Grilled Cheese', 'Nachos', 'Avocado Toast', 'Lemonade', 'Meatballs', 'Bagel',
      'Hot Chocolate', 'S\'mores', 'Coconut', 'Dumplings', 'Cereal', 'Pickle', 'Cupcake',
      'Peanut Butter', 'Mashed Potatoes', 'Chili Pepper', 'Fortune Cookie', 'Milkshake', 'Kebab',
    ]),
  },
  famous: {
    name: 'Famous People',
    kind: 'names',
    cards: names([
      'Albert Einstein', 'Taylor Swift', 'Abraham Lincoln', 'Beyoncé', 'Leonardo da Vinci',
      'Michael Jordan', 'Cleopatra', 'Elvis Presley', 'Marie Curie', 'Napoleon', 'Oprah Winfrey',
      'William Shakespeare', 'Serena Williams', 'Elon Musk', 'Mozart', 'Dwayne Johnson',
      'Frida Kahlo', 'Neil Armstrong', 'Lady Gaga', 'Gandhi', 'Muhammad Ali', 'Queen Elizabeth II',
      'Bob Ross', 'Steve Jobs', 'Michael Jackson', 'Amelia Earhart', 'Pablo Picasso',
      'Usain Bolt', 'Gordon Ramsay', 'Isaac Newton', 'Snoop Dogg', 'Joan of Arc',
      'Thomas Edison', 'Dolly Parton', 'Bruce Lee', 'Charles Darwin', 'Lionel Messi',
      'Julius Caesar', 'Keanu Reeves', 'Martin Luther King Jr.',
    ]),
  },
  infamous: {
    name: 'Infamous & Internet Famous',
    kind: 'names',
    cards: names([
      'Adolf Hitler', 'Benito Mussolini', 'King Leopold II', 'Osama bin Laden', 'Joseph Stalin',
      'Mao Zedong', 'Pol Pot', 'Saddam Hussein', 'Kim Jong Un', 'Vladimir Putin', 'Idi Amin',
      'Genghis Khan', 'Vlad the Impaler', 'Henry VIII', 'Marie Antoinette', 'Al Capone',
      'Pablo Escobar', 'El Chapo', 'Charles Manson',
      'Donald Trump', 'Barack Obama', 'George W. Bush', 'Joe Biden', 'Bill Clinton',
      'Richard Nixon', 'Ronald Reagan', 'John F. Kennedy', 'Winston Churchill', 'Fidel Castro',
      'James Charles', 'MoistCr1TiKaL', 'MrBeast', 'Johnny Sins', 'Yes King',
      'PewDiePie', 'Logan Paul', 'Jake Paul', 'KSI', 'IShowSpeed', 'Kai Cenat', 'xQc',
      'Markiplier', 'Jeffree Star', 'Shane Dawson', 'Andrew Tate', 'Salt Bae',
      'Hide the Pain Harold', 'Rick Astley', 'Keemstar', 'Bonnie Blue', 'Tom Brady',
      'Michael Myers', 'Mia Khalifa',
    ]),
  },
  characters: {
    name: 'Characters',
    kind: 'names',
    cards: names([
      'Sherlock Holmes', 'Darth Vader', 'Harry Potter', 'Mickey Mouse', 'Spider-Man', 'Shrek',
      'Batman', 'Mario', 'Pikachu', 'Gandalf', 'Wonder Woman', 'SpongeBob', 'Dracula',
      'Frankenstein\'s Monster', 'Homer Simpson', 'Elsa', 'Yoda', 'Captain Hook', 'Willy Wonka',
      'The Grinch', 'Buzz Lightyear', 'Sonic the Hedgehog', 'Robin Hood', 'Cinderella',
      'Hulk', 'Scooby-Doo', 'Winnie the Pooh', 'Gollum', 'Jack Sparrow', 'Peter Pan',
      'Santa Claus', 'Tooth Fairy', 'King Arthur', 'Godzilla', 'Kermit the Frog',
      'Indiana Jones', 'Link', 'Bugs Bunny', 'Superman', 'Tarzan',
    ]),
  },
  fantasy: {
    name: 'Fantasy & D&D',
    kind: 'names',
    cards: names([
      'Dragon', 'Beholder', 'Mimic', 'Owlbear', 'Gelatinous Cube', 'Lich', 'Mind Flayer',
      'Tarrasque', 'Bard', 'Paladin', 'Rogue', 'Wizard', 'Druid', 'Barbarian', 'Necromancer',
      'Goblin', 'Kobold', 'Troll', 'Vampire', 'Werewolf', 'Phoenix', 'Unicorn', 'Griffon',
      'Basilisk', 'Kraken', 'Bag of Holding', 'Fireball', 'Healing Potion', 'Tavern',
      'Dungeon Master', 'Natural 20', 'Critical Fail', 'Treasure Chest', 'Portal', 'Golem',
      'Gnome', 'Tiefling', 'Banshee', 'Hydra', 'Rust Monster',
    ]),
  },
  objects: {
    name: 'Everyday Objects',
    kind: 'names',
    cards: names([
      'Toothbrush', 'Umbrella', 'Stapler', 'Toaster', 'Ladder', 'Flashlight', 'Mirror',
      'Remote Control', 'Scissors', 'Pillow', 'Backpack', 'Hairdryer', 'Shopping Cart',
      'Vacuum Cleaner', 'Candle', 'Headphones', 'Microwave', 'Trampoline', 'Wheelbarrow',
      'Doorbell', 'Calculator', 'Bubble Wrap', 'Keyboard', 'Hammock', 'Fire Extinguisher',
      'Sunglasses', 'Alarm Clock', 'Paperclip', 'Mailbox', 'Rubber Duck', 'Plunger',
      'Lawn Mower', 'Treadmill', 'Snow Globe', 'Coat Hanger', 'Piggy Bank', 'Wristwatch',
      'Shoelace', 'Traffic Cone', 'Ceiling Fan',
    ]),
  },
  actions: {
    name: 'Act It Out',
    kind: 'names',
    cards: names([
      'Brushing Teeth', 'Skydiving', 'Riding a Horse', 'Bowling', 'Juggling', 'Surfing',
      'Changing a Diaper', 'Walking a Dog', 'Ice Skating', 'Rowing a Boat', 'Fishing',
      'Doing Yoga', 'Taking a Selfie', 'Climbing a Mountain', 'Playing Guitar', 'Sneezing',
      'Baking a Cake', 'Mowing the Lawn', 'Playing Video Games', 'Getting a Haircut',
      'Boxing', 'Blowing Bubbles', 'Hula Hooping', 'Sword Fighting', 'Milking a Cow',
      'Painting a Wall', 'Conducting an Orchestra', 'Swatting a Fly', 'Jump Rope',
      'Opening a Stuck Jar', 'Walking on Ice', 'Directing Traffic', 'Doing the Laundry',
      'Riding a Rollercoaster', 'Being a Zombie', 'Waking Up Late', 'Archery', 'Golfing',
      'Shoveling Snow', 'Rock Climbing',
    ]),
  },
  landmarks: {
    name: 'World Landmarks',
    kind: 'pictures',
    cards: [
      ['Eiffel Tower', 'Tour_Eiffel_Wikimedia_Commons.jpg'],
      ['Colosseum', 'Colosseo_2020.jpg'],
      ['Taj Mahal', 'Taj_Mahal_(Edited).jpeg'],
      ['Statue of Liberty', 'Statue_of_Liberty_7.jpg'],
      ['Great Wall of China', 'Great_Wall_of_China_July_2006.JPG'],
      ['Great Pyramid of Giza', 'Kheops-Pyramid.jpg'],
      ['Sydney Opera House', 'Sydney_Australia._(21339175489).jpg'],
      ['Machu Picchu', 'Machu_Picchu,_Peru.jpg'],
      ['Golden Gate Bridge', 'Golden_Gate_Bridge_as_seen_from_Battery_East.jpg'],
      ['Big Ben', 'Big_Ben_2007-1.jpg'],
      ['Stonehenge', 'Stonehenge2007_07_30.jpg'],
      ['Christ the Redeemer', 'Christ_the_Redeemer_-_Cristo_Redentor.jpg'],
      ['Petra', 'Petra_Jordan_BW_21.JPG'],
      ['Mount Rushmore', 'Mount_Rushmore_detail_view_(100MP).jpg'],
      ['Leaning Tower of Pisa', 'Leaning_tower_of_pisa_2.jpg'],
      ['Sagrada Família', 'Sagrada_Familia_01.jpg'],
      ['Neuschwanstein Castle', 'Neuschwanstein_Castle_LOC_print.jpg'],
      ['St. Basil\'s Cathedral', 'St_Basils_Cathedral-500px.jpg'],
    ].map(([text, file]) => ({ text, img: wiki(file) })),
  },
  paintings: {
    name: 'Famous Paintings',
    kind: 'pictures',
    cards: [
      ['Mona Lisa', 'Mona_Lisa,_by_Leonardo_da_Vinci,_from_C2RMF_retouched.jpg'],
      ['The Starry Night', 'Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg'],
      ['The Scream', 'The_Scream.jpg'],
      ['The Great Wave', 'Tsunami_by_hokusai_19th_century.jpg'],
      ['Girl with a Pearl Earring', 'Girl_with_a_Pearl_Earring.jpg'],
      ['American Gothic', 'Grant_Wood_-_American_Gothic_-_Google_Art_Project.jpg'],
      ['The Birth of Venus', 'Sandro_Botticelli_-_La_nascita_di_Venere_-_Google_Art_Project_-_edited.jpg'],
      ['The Creation of Adam', 'Michelangelo_-_Creation_of_Adam_(cropped).jpg'],
    ].map(([text, file]) => ({ text, img: wiki(file) })),
  },
  emoji: {
    name: 'Emoji Pictures',
    kind: 'pictures',
    cards: [
      ['Lion', '🦁'], ['Octopus', '🐙'], ['Unicorn', '🦄'], ['Penguin', '🐧'], ['Sloth', '🦥'],
      ['Flamingo', '🦩'], ['Dinosaur', '🦖'], ['Rocket', '🚀'], ['Volcano', '🌋'],
      ['Rainbow', '🌈'], ['Pizza', '🍕'], ['Taco', '🌮'], ['Ghost', '👻'], ['Robot', '🤖'],
      ['Alien', '👽'], ['Crown', '👑'], ['Tornado', '🌪'], ['Snowman', '⛄'], ['Cactus', '🌵'],
      ['Mushroom', '🍄'], ['Anchor', '⚓'], ['Lightning', '⚡'], ['Guitar', '🎸'],
      ['Magnet', '🧲'], ['Hourglass', '⌛'], ['Telescope', '🔭'], ['Balloon', '🎈'],
      ['Ninja', '🥷'], ['Mermaid', '🧜'], ['Vampire', '🧛'], ['Wizard', '🧙'], ['Dragon', '🐉'],
    ].map(([text, ch]) => ({ text, img: emoji(ch) })),
  },
};

window.DECKS = DECKS;
})();

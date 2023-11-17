require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const ejs = require("ejs");
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const session = require("express-session");
const passport = require("passport");
//const FacebookStrategy = require('passport-facebook').Strategy;
const LocalStrategy = require("passport-local").Strategy;
const multer = require('multer');


const app = express();

app.use(express.urlencoded({
    extended: false
}));

app.use(express.json());

app.set('view engine', 'ejs');

// app.use(bodyParser.urlencoded({extended: true}));
app.use(express.static("public"));

//session code
app.use(session({
    secret: "Our little secret.",
    resave: false,
    saveUninitialized: false
  }));

//auth

app.use(passport.initialize());
app.use(passport.session());

mongoose.connect(process.env.MONGODB_URI);
const customerSchema = new mongoose.Schema({
  username: String,
  password: String,
  googleId: String,
  plan: String,
});
const Customer = new mongoose.model("Customer", customerSchema);

const imageSchema = new mongoose.Schema({
  filename: String
});

const Image = mongoose.model('Image', imageSchema);


// Local 
passport.use(new LocalStrategy((username, password, done) => { //done is a callback function
    Customer.findOne({
      username: username
    }).then(customer => {
      if (!customer) {
        return done(null, false, {
          message: "Incorrect Username"
        })
      }
      // using bcrypt to encrypt password in register post route and compare function in login post round.
      // login post route will check here during authentication so need to use compare here
      bcrypt.compare(password, customer.password).then((isMatch) => {
        if (isMatch) {
          return done(null, customer)
        } else {
          return done(null, false, {
            message: "Incorrect Password"
          })
        }
      }).catch((err) => {
        return done(err)
      });
    }).catch((err) => {
      return done(err)
    });
}));

 // Google Auth Serialization
  // serialize customer
  passport.serializeUser(function(customer, done) {
    done(null, customer.id);
  });
  // deserialize customer
  passport.deserializeUser(function(id, done) {
    Customer.findById(id).then(customer => {
      done(null, customer);
    }).catch((err) => {
      return done(err)
    });
  });

  //Google auth
  passport.use(new GoogleStrategy({
    clientID: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    callbackURL: 'https://mmdp.onrender.com//auth/google/mmd'
  }, async function(accessToken, refreshToken, profile, done) {
    try {
      // console.log(profile);
      // Find or create customer in your database
      let customer = await Customer.findOne({
        googleId: profile.id
      });
      if (!customer) {
        // Create new customer in database
        //const username = Array.isArray(profile.emails) && profile.emails.length > 0 ? profile.emails[0].value.split('@')[0] : '';
        const newCustomer = new Customer({
          username: profile.displayName,
          googleId: profile.id
        });
        customer = await newCustomer.save();
      }
      return done(null, customer);
    } catch (err) {
      return done(err);
    }
  }));

app.get("/", function(req,res){
    res.render("home");
});

// gotta add the functionality of only letting customers with plans use this
app.get("/generate", function(req,res){
  
  if (req.isAuthenticated()) {
    // You can access the authenticated user's data from req.user
    const user = req.user;

    if (user) {
      // const images = user.imagesLeft;
      res.render("auth_generate");
    }
  } else {
    res.render("generate");
  }
});


// app.get("/checkout", function(req,res){
//     res.render("checkout");
// });

// gotta add the functionality of only letting customers who signed in use this
app.get("/auth_home", function(req, res){
  if (req.isAuthenticated()) {
    // You can access the authenticated user's data from req.user
    const user = req.user;

    if (user) {
      const name = user.username;
      res.render("auth_home", {
        user_name: name
      });
    }
  } else {
    res.render("home");
  }
});

app.get("/logout", function(req, res) {
    req.logout(function(err) {
      if (err) {
        console.log(err);
      }
      res.redirect("/");
      
    });
  });

app.get("/auth/google", passport.authenticate("google", {
    scope: ["profile"]
}));
app.get("/auth/google/mmd", passport.authenticate("google", {
    failureRedirect: "/"
}), function(req, res) {
    res.redirect("/auth_home");
    // Successful authentication, redirect auth_home.
});

// app route

  app.route("/checkout").get(function(req, res) {
    if (req.isAuthenticated()) {
      res.render("auth_checkout");
    } else {
      // alert("Please sign in to continue."); --alert doesn't works in node js
      res.redirect("/");
    }
  }).post(async function(req, res) {
    const choosen_plan = req.body.plan_type;
    let images = 0;
    if(choosen_plan == 'Basic'){
        images = 10;
    }
    else if(choosen_plan == 'Premium'){
        images = 100;
    }
    else if(choosen_plan == 'Enterprise'){
        images = 50000;
    }
    if (req.isAuthenticated()) {
      // You can access the authenticated user's data from req.user
      const user = req.user;
  
      if (user) {
        user.plan = choosen_plan;
        user.imagesLeft = images;
        
        try {
          await user.save();
          // Redirect or render to the desired page after the update
          res.render("auth_generate", {
            images_left: images
          });
        } catch (err) {
          console.error("Error updating user data:", err);
        }
      }
    } else {
      res.render("generate", {
        images_left: "1 (As of free trial)"
      });
    }
  });



// Post routes

// Download route
app.get("/download/:userId", function(req,res){
    const requestedID = req.params.userId;

    Customer.findOne({_id: requestedID}).then((found_user) => {
        res.render("download", {Username: found_user.username});
    }).catch((err) => {
        console.log(err);
    });
});

app.post("/register", function(req, res) {
    bcrypt.hash(req.body.password, 10, function(err, hash) { // 10 is SaltRounds
      if (err) {
        console.log(err);
      }
      const customer = new Customer({
        username: req.body.username,
        password: hash
      })
      customer.save();
      passport.authenticate('local')(req, res, () => {
        res.redirect("/auth_home");
      })
    })
  });

app.post('/', passport.authenticate('local', {
   successRedirect: "/auth_home",
   failureRedirect: '/'
}));

// Handling images
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/images'); // Specify the directory where the files will be saved
  },
  filename: (req, file, cb) => {
    // Generate a unique filename for the uploaded file
    cb(null, Date.now() + '_' + file.originalname);
  },
});

const upload = multer({ storage: storage });
app.post('/saveImage',upload.single('image') , async (req, res) => {
   // Assuming 'images' is the name of the file input field in your HTML form
  res.status(200).send('Images uploaded successfully');
});




// listen
var port = process.env.PORT || 5000;
app.listen(port, function(){
    console.log("Server started on port 5000.");
    console.log("")
});
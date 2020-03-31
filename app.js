/*
 * SPACE Text messaging service built with Node, express, twilio.
 * Heroku app: spacetext
 * Track an individual session using express-session cookies.
 *
 */
const http = require('http');
const express = require('express');
var ejs = require('ejs');
const path = require('path');
const session = require('express-session');
const MessagingResponse = require('twilio').twiml.MessagingResponse;
const bodyParser = require('body-parser');
var fs = require("fs");

var _twilioPhoneNumber = "+1 415 223 8333";



function read(f) {
  return fs.readFileSync(f).toString();
}
function include(f) {
  eval.apply(global, [read(f)]);
}


// Init express app.
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')))
.set('views', path.join(__dirname, 'views'))
.set('view engine', 'ejs');


app.use(bodyParser.urlencoded({
    extended: false
}));
app.use(session({
    secret: 'portal-sms-super-secret-sess-phrase'
}));



var Airtable = require('airtable');
var base = new Airtable({
    apiKey: 'key2ZI4HYHlIDwlna'
}).base('appAf7Pd5paoTJGMg');


/*
* Custom class for managing all Airtable data.
*
*/
var AirtableManager = function() {

    var _this = this;
    this.schedule = [];
    this.classRecordIdArray = [];
    this.spotsReserved = [];
    this.existingPhoneNumbersArray = [];

    this.resetData = function() {
        _this.schedule = [];
        _this.classRecordIdArray = [];
        _this.spotsReserved = [];
        _this.existingPhoneNumbersArray = [];
    }

    this.getExistingPhoneNumberSignups = function() {
        _this.existingPhoneNumbersArray = [];
        // Return list of exsisting phone numbers
        base('Community List').select({
            view: "API"
        }).eachPage(function page(records, fetchNextPage) {

            records.forEach(function(record) {
                //  console.log('Retrieved', record.get('Full Name'));

                var obj = {
                    "phone": record.get('Phone Number'),
                    "waitlist": record.get('Waitlist'),
                    "firstName": record.get('First Name'),
                    "lastName": record.get('Last Name'),
                    "waitlistStatus": record.get('Status'),
                    "personID": record.get('ID'),
                    "receivedOnboardText": record.get('Received Onboarding Text')
                };
                _this.existingPhoneNumbersArray.push(obj);

                //  console.log(obj);
            });
            fetchNextPage();

        }, function done(err) {
            if (err) {
                console.error(err);
                return;
            }
        });
    }

    this.getSchedule = function() {

        _this.schedule = [];
        _this.classRecordIdArray = [];
        _this.spotsReserved = [];


        base('Schedule').select({
            // Selecting the first 3 records in Grid view:
            filterByFormula: 'Published = 1',
            view: "Grid view"
        }).eachPage(function page(records, fetchNextPage) {
            // This function (`page`) will get called for each page of records.

            records.forEach(function(record) {
                if (record.get('Reserved') != record.get('Capacity')) {}
                console.log('Retrieved', record.get('Class'));
                _this.schedule.push(record.get('Short Date'));
                _this.classRecordIdArray.push(record.get('RecId'));
                _this.spotsReserved.push(record.get('Reserved') + '/' + record.get('Capacity'));

            });

            fetchNextPage();

        }, function done(err) {
            if (err) {
                console.error(err);
                return;
            }
        });
    }; // end getSchedule

    this.signUp = function(firstName, lastName, personID, phone, classRecordId) {

        console.log('Sign participant up:' + firstName + ' ' + classRecordId);
        base('Participants').create([{
            "fields": {
                "Name": firstName + " " + lastName,
                "First Name": firstName,
                "Last Name": lastName,
                "Person": [
                    personID
                ],
                "Phone Number": phone,
                "Class": [
                    classRecordId
                ]
            }
        }], function(err, records) {
            if (err) {
                console.error(err);
                return;
            }
            records.forEach(function(record) {
                console.log(record.getId());
            });
        });
    }

    this.joinWaitlist = function(firstName, lastName, email, phoneNumber) {
        base('Community List').create([{
            "fields": {
                "First Name": firstName,
                "Last Name": lastName,
                "Email": email,
                "Phone Number": phoneNumber,
                "Consent Granted": "Pending",
                "Status": "Interested",
                "Received Onboarding Text": "No"
            }
        }], function(err, records) {
            if (err) {
                console.error(err);
                return;
            }
            records.forEach(function(record) {
                console.log(record.getId());
            });
        });
    }


    this.logUserEvent = function(phoneNumber, eventType, messageBody = "", username = "") {

        base('Event Log').create([{
            "fields": {
                "Phone Number": phoneNumber,
                "Type": eventType,
                "Message": messageBody,
                "Name": username,
                "Response Status": "Unresolved"
            }
        }], function(err, records) {
            if (err) {
                console.error(err);
                return;
            }
            records.forEach(function(record) {
                console.log(record.getId());
            });
        });

    }



};



// Init Airtable.
var airtableManager = new AirtableManager();
airtableManager.getSchedule();
airtableManager.getExistingPhoneNumberSignups();

/* Refresh interval to get latest schedule every 2 minutes.
* TO-DO: Figure out faster way to retrieve data, make sure data isn't absent during the call time.
*
*/
var updateInterval = setInterval(function() {
    console.log('getExistingPhoneNumberSignups -- ')
    //airtableManager.resetData();
    airtableManager.getSchedule();
    //airtableManager.getExistingPhoneNumberSignups();
}, 120000);

var classOptionList = ['1', '2', '3', '4', '5', '6', '7', '8'];
var classOptionPossibilities = ['1', '2', '3', '4', '5', '6', '7', '8'];
var fullClassOptions = [];


app.post('/sms', (req, res) => {
    const smsCount = req.session.counter || 0;
    var choosingClassOpton = req.session.choosingClassOption || 0; // If viewing schedule, listen for class option ids in message.
    var classOptionSelected = req.session.classOptionSelected || 0;
    var menuStep = req.session.classOptionSelecte || "Welcome";
    var firstName = req.session.firstName || "";
    var lastName = req.session.lastName || "";
    var email = req.session.email || "";
    var message = '';

    var usermsg = req.body.Body;
    var phoneNum = req.body.From;
    phoneNum = phoneNum.replace('+1', ''); // Strip country code.
    console.log(req.body.Body);

    console.log(req.body);

    airtableManager.logUserEvent(phoneNum, 'Message', usermsg); // Capture all incoming messages.

    // All inbound user messages are trimmed, stripped of punctuation, and made lowercase.
    usermsg = usermsg.trim();
    if (req.session.menuStep !== "Get Email") {
        usermsg = usermsg.replace(/[^\w\s]|_/g, "").replace(/\s+/g, " ");
        usermsg = usermsg.toLowerCase();
    }
    // Helper to return line break(s)in text message.
    function lineBreak(num) {
        var resp = '';
        for (let i = 0; i < num; i++) {
            resp += '\n';
        }
        return resp;
    }

    // Call this to output the schedule.
    function outputSchedule() {
        req.session.choosingClassOption = 1;
        message += 'Book an upcoming class by replying with the number of the class you want to book (ie. reply "2").';
        message += lineBreak(2);

        // Loop through schedule array and append it to SMS body.
        for (var i = 0; i < airtableManager.schedule.length; i++) {
            message += classOptionList[i] + ' -- ' + airtableManager.schedule[i];
            message += lineBreak(1);
            console.log('airtableManager.spotsReserved[i] = ' + airtableManager.spotsReserved[i])
            if (airtableManager.spotsReserved[i] == "5/5" || airtableManager.spotsReserved[i] == "6/5" || airtableManager.spotsReserved[i] == "7/5") {
                message += '(Class is full)';
                var fullOption = Number(i);
                fullOption++;
                fullClassOptions.push(String(fullOption));
                console.log('fullClassOptions = ' + fullClassOptions);
            } else {
                message += '(' + airtableManager.spotsReserved[i] + ' spots filled)';
            }
            message += lineBreak(2);
        }
        message += lineBreak(2);
    }


    // Start analyzing inbound user message.
    // First check if phone number is on waitlist or not.
    var phoneNumberAlreadyWaitlisted = airtableManager.existingPhoneNumbersArray.find(person => person.phone === phoneNum);
    console.log(phoneNumberAlreadyWaitlisted)
    console.log('phoneNumberAlreadyWaitlisted = ' + phoneNumberAlreadyWaitlisted);


    if (typeof phoneNumberAlreadyWaitlisted == "undefined") {
        console.log("NOT IN WAITLIST");
        if (usermsg == "join") {
            message = 'We’d love to add you to the SPACE waitlist. What’s your first name?';
            req.session.menuStep = "Get First Name";
            airtableManager.logUserEvent(phoneNum, 'Ask To Join Waitlist', usermsg);
        } else if (req.session.menuStep == "Get First Name") {
            req.session.firstName = usermsg; // Store response.
            req.session.menuStep = "Get Last Name";
            message = 'What’s your last name?';
            airtableManager.logUserEvent(phoneNum, 'First Name', usermsg);
        } else if (req.session.menuStep == "Get Last Name") {
            req.session.lastName = usermsg;
            req.session.menuStep = "Get Email";
            message = 'What’s your email?';
            airtableManager.logUserEvent(phoneNum, 'Ask To Join Waitlist', usermsg);
        } else if (req.session.menuStep == "Get Email") {
            req.session.email = usermsg;
            req.session.menuStep = "Get Email";
            message = "Ok, sweet, you’ve been added to the waitlist, " + req.session.firstName.charAt(0).toUpperCase() + req.session.firstName.slice(1) + "!";
            message += lineBreak(2);
            message += "We’ll be in touch once we’re able to host you. If you have any questions, let us know by replying here.";
            airtableManager.joinWaitlist(req.session.firstName.charAt(0).toUpperCase() + req.session.firstName.slice(1), req.session.lastName, req.session.email, phoneNum);
            airtableManager.logUserEvent(phoneNum, 'Waitlist sign up complete', usermsg);
            req.session.menuStep = "In waitlist";

            setTimeout(function() {
                airtableManager.getSchedule();
                airtableManager.getExistingPhoneNumberSignups();
            }, 120000);
        }

        //First time contacting.
        else if (smsCount == 0 || usermsg == 'cancel') {
            message = 'Welcome to SPACE. To join the waitlist, reply JOIN.';
            message += '🚀';
            req.session.menuStep = "Welcome";
            airtableManager.logUserEvent(phoneNum, 'First Contact', usermsg);
        }

    } // End new signup
    else {


        console.log("NUMBER ALREADY IN COMMUNITY LIST");
        console.log(phoneNumberAlreadyWaitlisted.waitlistStatus);
        if (phoneNumberAlreadyWaitlisted.waitlistStatus == "Active" && phoneNumberAlreadyWaitlisted.receivedOnboardText == "Yes") {
            if (usermsg == "book") {
                console.log('BOOK')
                outputSchedule();

            } else if (classOptionPossibilities.includes(usermsg)) {

                if (fullClassOptions.includes(usermsg)) {

                    message = 'The class you selected is already full. Please select a class that has spots available.';
                    message += lineBreak(2);
                    outputSchedule();

                } else {

                    req.session.classOptionSelected = classOptionPossibilities.indexOf(usermsg);
                    airtableManager.signUp(phoneNumberAlreadyWaitlisted.firstName, phoneNumberAlreadyWaitlisted.lastName, phoneNumberAlreadyWaitlisted.personID, phoneNumberAlreadyWaitlisted.phone, airtableManager.classRecordIdArray[req.session.classOptionSelected]);

                    //message = 'Thank you, ' + phoneNumberAlreadyWaitlisted.firstName + '. ⭐';
                    message = 'Congrats, your class at SP/\\CE is confirmed for ' + airtableManager.schedule[req.session.classOptionSelected] + '.';
                    message += lineBreak(2);
                    //message += 'Your spot is confirmed for:';
                    //message += airtableManager.schedule[req.session.classOptionSelected] + '.';
                    //  message += airtableManager.schedule[req.session.classOptionSelected] + '.';
                    //  message += lineBreak(2);
                    message += 'Please arrive on time to our location at 955 South Van Ness Ave, SF (in the Mission) and enter through the right side gate. ';
                    message += lineBreak(2);
                    message += 'A few things to know:';
                    message += lineBreak(2);
                    message += '— We will provide you with a yoga mat, towel, and water.';
                    message += lineBreak(2);
                    message += '— The environment is heated to ~90°F with humidity added.';
                    message += lineBreak(2);
                    message += '— We don’t have showers on-site, but we do have a “dry bar” for you to freshen up after class. You may want to bring a change of clothes if you have plans afterward.';
                    message += lineBreak(2);
                    message += '— Drink plenty of water the day of class and refrain from eating a large meal 2 hours prior.';
                    message += lineBreak(2);
                    message += 'If you have any other questions please let us know! We’re looking forward to hosting you! ';



                    //      message += '(To book another class, reply BOOK)';
                    req.session.choosingClassOption = 0;
                    //airtableManager.getSchedule();
                    //airtableManager.getExistingPhoneNumberSignups();
                    airtableManager.logUserEvent(phoneNum, 'Spot Reserved', usermsg);

                }

            } else {
                message = "Thanks for your message, if you asked us a question our team will be in touch shortly.";
                //message += lineBreak(2);
                //message += 'To view the class schedule or book an upcoming class reply “BOOK”.'


                //outputSchedule();
                airtableManager.logUserEvent(phoneNum, 'Unrecognized Response', usermsg);
            }
        } else { // If waitlist status is "Pending".
            console.log('Person is ON waitlist.')
            message = "Hi " + phoneNumberAlreadyWaitlisted.firstName + ", you are currently on the waitlist. We have forwarded your message to our team and will be in touch shortly.";
            airtableManager.logUserEvent(phoneNum, 'QUESTION', usermsg, phoneNumberAlreadyWaitlisted.firstName);
        }
        console.log(phoneNumberAlreadyWaitlisted);
        var waitlistStatus = "";
    }

    // Cookie that counts how many times this person has texted us.
    req.session.counter = smsCount + 1;

    const twiml = new MessagingResponse();
    twiml.message(message);
    airtableManager.logUserEvent(_twilioPhoneNumber, 'Outbound', message);
    airtableManager.logUserEvent(phoneNum, 'Message', usermsg);

    /*
      res.writeHead(200, {'Content-Type': 'text/xml'});
      res.end(twiml.toString());
    */


    const sendTwimlPromise = new Promise(function(resolve, reject) {
        res.set('Content-Type', 'text/xml');
        res.status(200).send(twiml.toString());
        resolve('Success!');
    });

    sendTwimlPromise.then(function(value) {
        console.log(value);
        airtableManager.getSchedule();
        airtableManager.getExistingPhoneNumberSignups();
    });

});

app.get("/", function (req, res) {
  //res.sendFile(indexPg);
  res.send("SPACE text messaging service is currently operational");
  //res.sendFile(__dirname + '/index.html');
});

app.get("/sms", function (req, res) {
  res.send("SPACE text messaging service is currently operational.");
});

var port = process.env.PORT || 5000;
http.createServer(app).listen(port, () => {
    console.log('Express server listening on port ' + port);
});



/*
var express = require("express");
var app = express();
app.get("/", function (req, res) {
  res.send("Hello World whats up!");
});
app.listen(process.env.PORT, function () {
  console.log("Example app listening on port 3000!");
});*/

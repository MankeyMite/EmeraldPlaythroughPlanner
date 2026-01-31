the damage calculations for the scoring system will be quite expansive. here is a breakdown of the steps it should take to funciton:
The goal is that each of the pokemon on our team will get a individual simulated calculation for each of the trainers' pokemon. This will produce a score for each of our pokemon against all the trainers pokemon. To get the final score against the trainer, the tool will look at the best score against each trainer pokemon, basically finding out which of our pokemon is strongest against all the trainers' pokemon. Here is an example:

Our first pokemon on our planned team is swampert. When the auto fill button is clicked, the tool will fill in the species and best moves for them against all the trainers we want to calculate against. The user will then get the chance to make any changes to the moves and EVs and such, before clicking the "calcuate score against this trainer" button. We will use Roxanne as an example, since she is the first trainer. Here is what should happen when this button is clicked:

The tool will first make a simulated battle using the users first pokemon against Roxanne's first pokemon, geodude. In order to make this simulated battle, we need to first gather the exact stats for both pokemon. Since these exact stats already are calculated for the trainer pokemon, and the user pokemon's stats are calculated when the user clicks auto-fill button, we don't need to calculate them again. we simply take these stats into calculation for the damage for both parties.

First, it will calculate the best move for Geodude vs our first pokemon, which in this example is Mudkip, by checking the damage of each moves and choosing the one that has the highest damage roll as its main attacking move for the damage calculation. the damage will be calculated in percent (%). Since there is a 85-100 randomness roll in attacks in this game, we will use the mid-roll to simplify the calculation.

Now the best move for the user's pokemon will be calculated in the same way. After this is done, the calculator will give "points" to the users Pokemon in the following way:

The points system will aim to show the user exactly how well their pokemon works against the opposing pokemon by giving a score of 1-10. 

It will give out points in the following categories:

1. Offense: 0-3 points. 3 points if the user pokemon has a guaranteed OHKO on the opponant. 2 points if it has a guaranteed 2HKO, 1 point if it has a 3HKO, and 0 points if it has a 4HKO or worse.
2. Defense. 0-6. 6 if the user pokemon can take at least 6 hits or more before its HP reaches 0. 5 points if it can take 5 hits. 4 points if it can take 4 hits. 3 points if it can take 3 hits. 2 points if it can take 2 hits. 1 point if it can only take 1 hit without fainting, and 0 points if it cannot survive a single hit. 
3. Speed. 0-1 points. 1 point if the user pokemon outspeeds (has more speed than the trainer pokemon they are calculated against). 0.5 points if it's a speed tie, and 0 points if the opponent is faster. 

exceptions: 
1. IF the user pokemon can outspeed the opponent AND take it out in a OHKO, give it 10 points. 
2. IF the user does not take ANY damage from its opponent, maybe because it's immune, give it 10 points as long as we have a move that can deal damage back.


After the points have been calculated, they will be shown in a small spreadsheet right underneath the pokemon cards. It will look like this:

Top row: (space), Geodude, Geodude, Nosepass
First column, going top to botton: (space), mudkip, other pokemon on the team.. 
The points would be filled out like this for example for mudkip: 7, 6, 5. - each of these score numbers would be lined up underneath the trainer pokemon the score was taken from so you can visually see how each of your pokemon on the team is doing against this team. 
the last row after all the users pokemon, will say "best score", and take the highest score number from the users pokemon and display the best score number against that particular trainer pokemon. For example, mudkip had 7 points against the first geodude, but our tailow had 2 points against it, so the best score was 8. 
After the "best score" has been calculated for each of Roxanne's pokemon, the last column on the right will show an average best score for this trainer. It will take all the best scores for each pokemon, and make an average of those, and this is the final score that the user will get to see how well their team does against this trainer. This is also the score that will show at the top right where we currently have our score. 

So after the users first pokemon has calculated its performance against the trainer's first pokemon, the score will be filled into this spreadsheet and it will start calculating the performance of Mudkip against the next trainer pokemon, in the same way, assuming Mudkip is back at full health, to simulate individual performance. When all trainer pokemon has been calculated against the users first pokemon, the entire process continues with the user's next pokemon. It will continue until all the users' pokemon for each trainer has been calculated and recieved a score. Then the average score will be calculated, and this final score is displayed on the top right. 
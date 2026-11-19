
import React, { useEffect, useState } from "react";
import { supabase } from "./supabase";

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [teams, setTeams] = useState([]);
  const [matches, setMatches] = useState([]);
  const [tournament, setTournament] = useState(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [registering, setRegistering] = useState(false);

  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);

  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamSeed, setNewTeamSeed] = useState("");
  const [selectedPlayer, setSelectedPlayer] = useState("");
  const [selectedTeam, setSelectedTeam] = useState("");
  const [adminPlayers, setAdminPlayers] = useState([]);

  // LOAD TOURNAMENT AND BRACKET
  async function loadTournament() {
    const { data: event, error: eventError } = await supabase
      .from("tournaments")
      .select("*")
      .eq("slug", "zrl-anaheim")
      .single();

    if (eventError) {
      setMessage("Could not load tournament: " + eventError.message);
      setLoading(false);
      return;
    }

    setTournament(event);

    const { data: teamData, error: teamError } = await supabase
      .from("teams")
      .select("*")
      .eq("tournament_id", event.id)
      .order("seed");

    const { data: matchData, error: matchError } = await supabase
      .from("matches")
      .select("*")
      .eq("tournament_id", event.id)
      .order("round_number")
      .order("match_number");

    if (teamError || matchError) {
      setMessage(
        "Could not load bracket information: " +
          (teamError?.message || matchError?.message)
      );
    } else {
      setTeams(teamData || []);
      setMatches(matchData || []);
    }

    setLoading(false);
  }

  // LOAD PLAYER PROFILE
  async function loadProfile(user) {
    if (!user) {
      setProfile(null);
      return;
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      setMessage("Could not load player profile: " + error.message);
      setProfile(null);
      return;
    }

    setProfile(data || null);
  }

  // HANDLE EMAIL CONFIRMATION LINKS
  useEffect(() => {
    let active = true;

    async function confirmEmail() {
      const params = new URLSearchParams(window.location.search);
      const tokenHash = params.get("token_hash");
      const type = params.get("type");

      if (!tokenHash || type !== "email") return;

      setMessage("Confirming your email address...");

      const { data, error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: "email"
      });

      if (!active) return;

      if (error) {
        setMessage(
          "Email confirmation failed: " +
            error.message +
            ". You may need a new confirmation email."
        );
        return;
      }

      setSession(data.session || null);
      await loadProfile(data.user);

      if (!active) return;

      setMessage(
        "Your email has been confirmed successfully! Welcome to ZRL Competitive Arena."
      );

      // Remove the confirmation token from the browser address.
      window.history.replaceState(
        {},
        document.title,
        window.location.pathname + window.location.hash
      );
    }

    confirmEmail();

    return () => {
      active = false;
    };
  }, []);

  // INITIAL LOAD AND AUTHENTICATION LISTENER
  useEffect(() => {
    let mounted = true;

    async function start() {
      await loadTournament();

      const { data, error } = await supabase.auth.getSession();

      if (!mounted) return;

      if (error) {
        setMessage("Authentication error: " + error.message);
      }

      setSession(data.session);
      await loadProfile(data.session?.user);
    }

    start();

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        if (!mounted) return;

        setSession(newSession);

        // Load the profile after the authentication event.
        if (newSession?.user) {
          setTimeout(() => {
            if (mounted) loadProfile(newSession.user);
          }, 0);
        } else {
          setProfile(null);
        }
      }
    );

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  // LIVE BRACKET UPDATES
  useEffect(() => {
    if (!tournament) return;

    const channel = supabase
      .channel("zrl-live-bracket")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "matches",
          filter: `tournament_id=eq.${tournament.id}`
        },
        () => loadTournament()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "teams",
          filter: `tournament_id=eq.${tournament.id}`
        },
        () => loadTournament()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tournament]);

  // PLAYER REGISTRATION AND SIGN IN
  async function handleAuth(event) {
    event.preventDefault();
    setMessage("");
    setAuthLoading(true);

    try {
      if (registering) {
        if (!displayName.trim()) {
          setMessage("Please enter your player name.");
          return;
        }

        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: {
              display_name: displayName.trim()
            }
          }
        });

        if (error) {
          setMessage("Registration failed: " + error.message);
          return;
        }

        if (data.user && !data.session) {
          setMessage(
            "Your player account has been created! Check your email and click the confirmation link before signing in."
          );
        } else {
          setMessage("Your player account has been created successfully!");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password
        });

        if (error) {
          setMessage(
            error.message.toLowerCase().includes("email not confirmed")
              ? "Your email has not been confirmed yet. Check your inbox or use the RESEND CONFIRMATION EMAIL button below."
              : "Sign-in failed: " + error.message
          );
          return;
        }

        setMessage("You have successfully signed in!");
      }
    } finally {
      setAuthLoading(false);
    }
  }

  // RESEND CONFIRMATION EMAIL
  async function resendConfirmationEmail() {
    if (!email.trim()) {
      setMessage("Enter your email address first.");
      return;
    }

    setAuthLoading(true);
    setMessage("");

    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: email.trim(),
        options: {
          emailRedirectTo: window.location.origin
        }
      });

      if (error) {
        setMessage("Could not resend confirmation: " + error.message);
      } else {
        setMessage(
          "A new confirmation email has been requested. Check your inbox and spam folder."
        );
      }
    } finally {
      setAuthLoading(false);
    }
  }

  // SIGN OUT
  async function logout() {
    const { error } = await supabase.auth.signOut();

    if (error) {
      setMessage("Sign-out failed: " + error.message);
      return;
    }

    setProfile(null);
    setMessage("You have signed out.");
  }

  // PLAYER VOTING
  async function castVote(match, winnerId) {
    if (!session || !profile) {
      setMessage(
        "Please sign in and make sure your player profile is ready."
      );
      return;
    }

    const { error } = await supabase.from("match_votes").insert({
      match_id: match.id,
      voter_id: session.user.id,
      voted_for_team_id: winnerId
    });

    if (error) {
      setMessage(
        error.code === "23505"
          ? "You have already voted in this match."
          : error.message
      );
    } else {
      setMessage("Your vote has been submitted!");
    }
  }

  // TEAM NAME LOOKUP
  function teamName(id) {
    if (!id) return "Waiting for winner";

    return teams.find((team) => team.id === id)?.name || "Team";
  }

  // ADMIN: ADD TEAM
  async function addTeam() {
    if (!newTeamName.trim() || !tournament) {
      setMessage("Enter a team name first.");
      return;
    }

    const { error } = await supabase.from("teams").insert({
      tournament_id: tournament.id,
      name: newTeamName.trim(),
      seed: Number(newTeamSeed) || teams.length + 1
    });

    if (error) {
      setMessage("Could not add team: " + error.message);
      return;
    }

    setNewTeamName("");
    setNewTeamSeed("");
    setMessage("Team added successfully!");
    await loadTournament();
  }

  // ADMIN: UPDATE MATCH WINNER
  async function updateMatchWinner(match, winnerId) {
    const { error } = await supabase
      .from("matches")
      .update({
        winner_team_id: winnerId,
        status: "verified"
      })
      .eq("id", match.id);

    if (error) {
      setMessage("Could not update match: " + error.message);
      return;
    }

    setMessage("Match winner updated!");
    await loadTournament();
  }

  // ADMIN: LOAD PLAYERS
  async function loadAdminPlayers() {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .order("display_name");

    if (error) {
      setMessage("Could not load players: " + error.message);
      return;
    }

    setAdminPlayers(data || []);
    setMessage("Player list loaded.");
  }

  // ADMIN: ASSIGN PLAYER TO TEAM
  async function assignPlayer() {
    if (!selectedPlayer || !selectedTeam) {
      setMessage("Select both a player and a team.");
      return;
    }

    const { error } = await supabase
      .from("profiles")
      .update({ team_id: selectedTeam })
      .eq("id", selectedPlayer);

    if (error) {
      setMessage("Could not assign player: " + error.message);
      return;
    }

    setMessage("Player assigned successfully!");
    await loadAdminPlayers();
    await loadProfile(session.user);
  }

  // ROUND TITLES
  function roundTitle(round) {
    return {
      1: "QUARTER FINALS",
      2: "SEMI FINALS",
      3: "GRAND FINALS"
    }[round] || "TOURNAMENT";
  }

  const roundNumbers = [1, 2, 3];

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#">
          <span className="brand-mark">Z</span>
          <span>
            ZRL <b>COMPETITIVE ARENA</b>
          </span>
        </a>

        <nav>
          <a href="#bracket">Bracket</a>
          <a href="#account">Player Account</a>
          {profile?.role === "admin" && <a href="#admin">Admin</a>}
        </nav>

        {session ? (
          <button className="outline-button" onClick={logout}>
            Sign Out
          </button>
        ) : (
          <a className="primary-button" href="#account">
            Player Login
          </a>
        )}
      </header>

      <main>
        <section className="hero">
          <div className="hero-content">
            <span className="eyebrow">THE COMPETITIVE STANDARD</span>
            <h1>PROVE YOURSELF.</h1>
            <p>
              Compete against the best. Earn your place.
              Welcome to ZRL Competitive Arena.
            </p>
            <a className="primary-button" href="#bracket">
              VIEW TOURNAMENT
            </a>
          </div>

          <div className="hero-side">
            <div className="hero-symbol">ZRL</div>
            <span>COMPETE. DOMINATE. REPEAT.</span>
          </div>
        </section>

        <section className="event-bar">
          <div>
            <span className="eyebrow">CURRENT EVENT</span>
            <h2>{tournament?.name || "ZRL TOURNAMENT"}</h2>
          </div>

          <span className={`event-status ${tournament?.status || "upcoming"}`}>
            {tournament?.status || "Loading"}
          </span>
        </section>

        {message && (
          <div className="message" role="status">
            {message}
            <button onClick={() => setMessage("")}>×</button>
          </div>
        )}

        {/* TOURNAMENT BRACKET */}
        <section id="bracket" className="section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">FOLLOW THE COMPETITION</span>
              <h2>TOURNAMENT BRACKET</h2>
            </div>
            <span className="live-label">LIVE UPDATES</span>
          </div>

          {loading ? (
            <p className="empty-state">Loading tournament...</p>
          ) : (
            <div className="rounds">
              {roundNumbers.map((round) => (
                <div className="round-column" key={round}>
                  <h3>{roundTitle(round)}</h3>

                  {matches
                    .filter((match) => match.round_number === round)
                    .map((match) => (
                      <article className="match-card" key={match.id}>
                        <div className="match-heading">
                          <span>MATCH {match.match_number}</span>
                          <span className={`match-status ${match.status}`}>
                            {match.status}
                          </span>
                        </div>

                        {[match.team1_id, match.team2_id].map(
                          (teamId, index) => {
                            const isWinner =
                              match.winner_team_id === teamId && teamId;

                            return (
                              <div
                                className={`team-row ${
                                  isWinner ? "winner" : ""
                                }`}
                                key={index}
                              >
                                <span>{teamName(teamId)}</span>
                                {isWinner && <b>WINNER</b>}
                              </div>
                            );
                          }
                        )}

                        {match.status !== "verified" &&
                          match.team1_id &&
                          match.team2_id &&
                          profile?.team_id &&
                          [match.team1_id, match.team2_id].includes(
                            profile.team_id
                          ) && (
                            <div className="vote-area">
                              <span>VOTE FOR MATCH WINNER</span>
                              <button
                                onClick={() =>
                                  castVote(match, match.team1_id)
                                }
                              >
                                {teamName(match.team1_id)}
                              </button>
                              <button
                                onClick={() =>
                                  castVote(match, match.team2_id)
                                }
                              >
                                {teamName(match.team2_id)}
                              </button>
                            </div>
                          )}
                      </article>
                    ))}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* PLAYER ACCOUNT */}
        <section id="account" className="section account-section">
          <div>
            <span className="eyebrow">JOIN THE ARENA</span>
            <h2>PLAYER ACCOUNT</h2>
            <p>
              Sign in to access eligible match voting and tournament features.
            </p>
          </div>

          {session ? (
            <div className="account-card">
              <h3>
                Welcome, {profile?.display_name || session.user.email}
              </h3>
              <p>{session.user.email}</p>
              <p>Account type: {profile?.role || "Player"}</p>
              <p>Team: {teamName(profile?.team_id)}</p>

              {!profile?.team_id && (
                <p className="helper">
                  An administrator needs to assign you to a team before you
                  can vote.
                </p>
              )}
            </div>
          ) : (
            <form className="account-card" onSubmit={handleAuth}>
              <div className="auth-switch">
                <button
                  type="button"
                  className={!registering ? "selected" : ""}
                  onClick={() => {
                    setRegistering(false);
                    setMessage("");
                  }}
                >
                  SIGN IN
                </button>

                <button
                  type="button"
                  className={registering ? "selected" : ""}
                  onClick={() => {
                    setRegistering(true);
                    setMessage("");
                  }}
                >
                  REGISTER
                </button>
              </div>

              {registering && (
                <input
                  placeholder="Player name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                />
              )}

              <input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />

              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />

              <button
                className="primary-button full-button"
                type="submit"
                disabled={authLoading}
              >
                {authLoading
                  ? "PLEASE WAIT..."
                  : registering
                    ? "CREATE PLAYER ACCOUNT"
                    : "SIGN IN"}
              </button>

              {!registering && (
                <button
                  type="button"
                  className="outline-button full-button"
                  onClick={resendConfirmationEmail}
                  disabled={authLoading}
                >
                  RESEND CONFIRMATION EMAIL
                </button>
              )}
            </form>
          )}
        </section>

        {/* ADMIN DASHBOARD */}
        {profile?.role === "admin" && (
          <section id="admin" className="section">
            <span className="eyebrow">TOURNAMENT CONTROL</span>
            <h2>ZRL ADMIN DASHBOARD</h2>

            <div className="account-card">
              <h3>TEAM MANAGEMENT</h3>

              <input
                placeholder="New team name"
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
              />

              <input
                type="number"
                placeholder="Team seed"
                value={newTeamSeed}
                onChange={(e) => setNewTeamSeed(e.target.value)}
              />

              <button className="primary-button" onClick={addTeam}>
                ADD TEAM
              </button>

              <h3>REGISTERED TEAMS</h3>

              {teams.map((team) => (
                <p key={team.id}>
                  #{team.seed} — {team.name}
                </p>
              ))}
            </div>

            <div className="account-card">
              <h3>PLAYER MANAGEMENT</h3>

              <button
                className="primary-button"
                onClick={loadAdminPlayers}
              >
                LOAD PLAYERS
              </button>

              <select
                value={selectedPlayer}
                onChange={(e) => setSelectedPlayer(e.target.value)}
              >
                <option value="">Select player</option>

                {adminPlayers.map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.display_name || player.id}
                  </option>
                ))}
              </select>

              <select
                value={selectedTeam}
                onChange={(e) => setSelectedTeam(e.target.value)}
              >
                <option value="">Assign to team</option>

                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>

              <button className="primary-button" onClick={assignPlayer}>
                ASSIGN PLAYER
              </button>
            </div>

            <div className="account-card">
              <h3>MATCH MANAGEMENT</h3>

              {matches.map((match) => (
                <div key={match.id}>
                  <p>
                    {roundTitle(match.round_number)} — Match{" "}
                    {match.match_number}
                  </p>

                  <p>
                    {teamName(match.team1_id)} vs{" "}
                    {teamName(match.team2_id)}
                  </p>

                  {match.team1_id && (
                    <button
                      onClick={() =>
                        updateMatchWinner(match, match.team1_id)
                      }
                    >
                      WINNER: {teamName(match.team1_id)}
                    </button>
                  )}

                  {match.team2_id && (
                    <button
                      onClick={() =>
                        updateMatchWinner(match, match.team2_id)
                      }
                    >
                      WINNER: {teamName(match.team2_id)}
                    </button>
                  )}

                  <hr />
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      <footer>
        <b>ZRL COMPETITIVE ARENA</b>
        <span>COMPETE WITH PURPOSE.</span>
      </footer>
    </div>
  );
}

  );
}

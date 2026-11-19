import React from "react";
import { useEffect, useState } from "react";
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
const [newTeamName, setNewTeamName] = useState("");
const [newTeamSeed, setNewTeamSeed] = useState("");
const [selectedPlayer, setSelectedPlayer] = useState("");
const [selectedTeam, setSelectedTeam] = useState("");
const [adminPlayers, setAdminPlayers] = useState([]);
  
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
      setMessage("Could not load bracket information.");
    } else {
      setTeams(teamData || []);
      setMatches(matchData || []);
    }

    setLoading(false);
  }

  async function loadProfile(user) {
    if (!user) {
      setProfile(null);
      return;
    }

    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    setProfile(data || null);
  }

  useEffect(() => {
    let mounted = true;

    async function start() {
      await loadTournament();

      const { data } = await supabase.auth.getSession();

      if (mounted) {
        setSession(data.session);
        await loadProfile(data.session?.user);
      }
    }

    start();

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        if (!mounted) return;
        setSession(newSession);
        await loadProfile(newSession?.user);
      }
    );

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

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

  async function handleAuth(event) {
    event.preventDefault();
    setMessage("");

    if (registering) {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: displayName }
        }
      });

      if (error) {
        setMessage(error.message);
      } else {
        setMessage(
          "Registration submitted! Check your email if confirmation is required."
        );
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) setMessage(error.message);
    }
  }

  async function logout() {async function addTeam() {
  if (!newTeamName.trim()) return;

  const { error } = await supabase.from("teams").insert({
    tournament_id: tournament.id,
    name: newTeamName.trim(),
    seed: Number(newTeamSeed) || teams.length + 1
  });

  if (error) {
    setMessage(error.message);
    return;
  }

  setNewTeamName("");
  setNewTeamSeed("");
  setMessage("Team added successfully!");
  await loadTournament();
}

async function updateMatchWinner(match, winnerId) {
  const { error } = await supabase
    .from("matches")
    .update({
      winner_team_id: winnerId,
      status: "verified"
    })
    .eq("id", match.id);

  if (error) {
    setMessage(error.message);
    return;
  }

  setMessage("Match winner updated!");
  await loadTournament();
}

async function loadAdminPlayers() {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .order("display_name");

  if (error) {
    setMessage(error.message);
    return;
  }

  setAdminPlayers(data || []);
}

async function assignPlayer() {
  if (!selectedPlayer || !selectedTeam) return;

  const { error } = await supabase
    .from("profiles")
    .update({ team_id: selectedTeam })
    .eq("id", selectedPlayer);

  if (error) {
    setMessage(error.message);
    return;
  }

  setMessage("Player assigned successfully!");
  await loadAdminPlayers();
}
    await supabase.auth.signOut();
    setMessage("You have signed out.");
  }

  async function castVote(match, winnerId) {
    if (!session || !profile) {
      setMessage("Please sign in and make sure your player profile is ready.");
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

  function teamName(id) {
    if (!id) return "Waiting for winner";
    return teams.find((team) => team.id === id)?.name || "Team";
  }

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
          <span>ZRL <b>COMPETITIVE ARENA</b></span>
        </a>

        <nav>
          <a href="#bracket">Bracket</a>
          <a href="#account">Player Account</a>
          {profile?.role === "admin" && (
            <a href="#admin">Admin</a>
          )}
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
                                className={`team-row ${isWinner ? "winner" : ""}`}
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
              <h3>Welcome, {profile?.display_name || session.user.email}</h3>
              <p>{session.user.email}</p>
              <p>
                Account type: {profile?.role || "Player"}
              </p>
              <p>
                Team: {teamName(profile?.team_id)}
              </p>
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
                  onClick={() => setRegistering(false)}
                >
                  SIGN IN
                </button>
                <button
                  type="button"
                  className={registering ? "selected" : ""}
                  onClick={() => setRegistering(true)}
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

              <button className="primary-button full-button" type="submit">
                {registering ? "CREATE PLAYER ACCOUNT" : "SIGN IN"}
              </button>
            </form>
          )}
        </section>

        {profile?.role === "admin" && (
          <section id="admin" className="section">
            <span className="eyebrow">TOURNAMENT CONTROL</span>
            <h2>ADMIN ACCESS</h2>
            <p>
              Your administrator account is recognized. Team editing and
              match management controls will be added after the database
              permissions are configured.
            </p>
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

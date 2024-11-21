import express from "express";
import bodyparser from "body-parser";
import argon2 from "argon2";
import pg from "pg";
import cors from "cors";

var MIN_LENGTH_PASSWORD=8;
var MAX_LENGTH_PASSWORD=16;


const app=express();
app.use(cors());
// const db=new pg.Client({
//     user: "postgres",
//     host: "localhost",
//     database: "Book e commerce",
//     password: "kiruthik_7275",
//     port: 5432,

// });
const db = new pg.Client({
    connectionString: 'postgresql://postgres.yoxouotutdshgigofdlr:Kiruthik_1105@aws-0-ap-south-1.pooler.supabase.com:6543/postgres'
});
db.connect();
app.use(bodyparser.json());
//this is the endpoint for signup
app.post("/signup",async (req,res)=>{
    const {userName,password,rePassword}=req.body;
    console.log(userName+" "+password+" "+rePassword);
    try{
        if(!req.body) return res.sendStatus(400);
        if(!userName || !password || !rePassword) {
             return res.status(400).send('missing username or password or repassword');
        }
        if(password!==rePassword) {
            return res.status(400).send('passwords not matching');
        }
        if(password.length<MIN_LENGTH_PASSWORD || password.length>MAX_LENGTH_PASSWORD) {
            return res.status(400).send('password must be within 8 to 160 letters');
        }
        const existingUser = await db.query('SELECT * FROM user_credentials WHERE username = $1', [userName]);
        if (existingUser.rows.length > 0) {
            return res.status(400).send('Username already exists');
        }
        const hashedPassword = await argon2.hash(password);
        const result=await db.query("INSERT INTO user_credentials (username, password) VALUES ($1, $2) RETURNING id", [userName, hashedPassword]);

        return res.status(200).json({message:'Signup successful',userId:result.rows[0].id});



    }catch(err){
        console.error(err);
        return res.status(500).json({ message: 'Database error', error: err });
    }




});
//this is the endpoint for login
app.post("/login",async (req,res)=>{
    const {userName, password}= req.body;
    console.log(userName+" "+password);
    try{
        if(!req.body) {
            return res.status(400).send('enter username and password');
        }
        if(!userName|| !password) {
           return res.status(400).send('missing username or password');
        }
        const result=await db.query("select * from user_credentials where username=$1",[userName]);
        if(result.rows.length===0) {
            return res.status(400).send("no existing user");
        }
        if(await argon2.verify(result.rows[0].password, password)) {
            return res.status(200).json({message:"Login successful",userId:result.rows[0].id});
        }
        else {
            return res.status(400).send("invalid username or password");
        }    
    }catch(err){
        console.error(err);
        return res.status(500).json({ message: 'Database error', error: err });

    }

});

//this is the endpoint for orders
app.get("/orders/:userId",async (req,res)=>{
    const userId=req.params.userId;
    try{
        const result=await db.query("SELECT b.isbn,b.title,b.image_link,o.quantity,o.price,TO_CHAR(o.order_date,'YYYY-MM-DD') AS order_date,o.delivery_status,o.payment_method from orders_new o INNER JOIN books_new b ON b.isbn=o.isbn WHERE o.user_id=$1",[userId]);
        if(result.rows.length===0) return res.status(400).send("no orders yet!! wanna buy something??");
        else return res.status(200).json(result.rows);

    }catch(err){
        console.log("Error in orders: ",err.message);
        res.status(500).json({message: "internal server error"});
    }
});
//this is the endpoint for cart
app.get("/cart/:userId",async (req,res)=>{
    const userId=req.params.userId;
    try{
        const result=await db.query("SELECT b.isbn,b.title,b.image_link,c.quantity,c.price from books_new b INNER JOIN cart_new c ON b.isbn=c.isbn WHERE c.user_id=$1",[userId]);
        if(result.rows.length===0) return res.status(404).send("No items in the cart!!");
        else return res.status(200).json(result.rows);

    }catch(err){
        console.log("Error in cart: ",err.message);
        res.status(500).json({message: "internal server error"});
    }
});
//endpoint to add the item to cart
app.post('/add-to-cart',async (req,res)=>{
    const {userId,itemId,price}=req.body; //here itemId is isbn
    if(!req.body) return res.status(400).send("No userid and cartId to add into the cart");
    try{
        if(!userId || !itemId) return res.status(400).send("Missing value");
        else{
            const exisitingItem=await db.query("SELECT * from cart_new WHERE user_id=$1 AND isbn=$2",[userId,itemId]);
            if(exisitingItem.rows.length>0){
                const newQuantity=exisitingItem.rows[0].quantity+1;
                const newPrice=exisitingItem.rows[0].price*newQuantity;
                await db.query("UPDATE cart_new SET quantity=$1,price=$2 WHERE user_id=$3 AND isbn=$4",[newQuantity,newPrice,userId,itemId]);
                return res.status(200).send("quantity updated successfully!!");

            }
            else{
                const quantity=1;
                await db.query('INSERT into cart_new(user_id,isbn,quantity,price) VALUES($1,$2,$3,$4)',[userId,itemId,quantity,price]);
                return res.status(200).send("item added successfully");

            }

        }
    }catch(err){
        console.log("error in adding to cart",err.message);
        res.status(400).json({message:"internal server error"});
    }

});
//end point to pay and convert the cart items if payed to orders
app.post('/pay',async (req,res)=>{
    const {userId,paymentMethod}=req.body;
    if(!userId) return res.status(400).send("Please login to pay");
    try{
        const cartItems = await db.query('SELECT * FROM cart_new WHERE user_id = $1', [userId]);
        if(cartItems.rows.length===0) return res.send(400).status("No items in the cart or Payment unsuccessful!!");
        const insertQuery = `
            INSERT INTO orders_new (user_id, isbn, quantity, price, delivery_status, payment_method)
            VALUES ${cartItems.rows.map((_, index) => 
                `($1, $${index * 3 + 2}, $${index * 3 + 3}, $${index * 3 + 4}, 'Pending', $${cartItems.rows.length * 3 + 2})`
            ).join(', ')}
        `;
        const insertParams = [userId, ...cartItems.rows.flatMap(item => [item.isbn,item.quantity,item.price]) ,paymentMethod];
        await db.query(insertQuery, insertParams);
        await db.query('DELETE FROM cart_new WHERE user_id = $1', [userId]);
        return res.status(200).send("Payment successful! Please go look at the orders!!");
        

    }catch(err){
        console.log("error:",err.message);
        res.status(500).json({message:"Internal server error"});
    }
});
//this is the end point for books
app.get("/books", async (req, res) => {
    const category = req.query.category; // Get category from query
    const page = parseInt(req.query.page) || 1; 
    const limit = parseInt(req.query.limit) || 10; 
    const offset = (page - 1) * limit;

    

    try {
        let query = `
            SELECT b.isbn, b.title, b.authors, b.genre, b.image_link, b.year, b.description, b.average_rating, b.pages, b.ratings_count, b.price
            FROM books_new b `;

        if (category === "trending") {
            query += 'INNER JOIN trending_new t ON b.isbn = t.isbn ORDER BY t.popularity DESC ';
        } else if (category === 'discount') {
            query += 'INNER JOIN discount_new d ON b.isbn = d.isbn ORDER BY d.discount_percentage ';
        }

        query += `LIMIT $1 OFFSET $2`;
        const result = await db.query(query, [limit, offset]);

        if (result.rows.length === 0) {
            return res.status(404).send(`No books found for category: ${category}`);
        }

        let countQuery = 'SELECT COUNT(*) FROM books_new b';
        if (category === 'trending') {
            countQuery += ` INNER JOIN trending_new t ON b.isbn = t.isbn`;
        } else if (category === "discount") {
            countQuery += ` INNER JOIN discount_new d ON b.isbn = d.isbn`;
        }

        const countResult = await db.query(countQuery);
        const totalBooks = parseInt(countResult.rows[0].count, 10);
        const totalPages = Math.ceil(totalBooks / limit);

        res.status(200).json({
            page,
            limit,
            totalPages,
            totalBooks,
            books: result.rows,
        });
    } catch (err) {
        console.error('Error fetching books:', err.message);
        res.status(500).json({ message: "Internal server error" });
    }
});

app.delete("/delete-item",async (req,res)=>{

    const {userId,itemId}=req.body;
    if(!req.body) return res.status(400).send("No userid or cartid to delete from the cart!!");
    try{
        if(!userId || !itemId){
            return res.status(400).send("Missing values!!");
        }
        else{
            await db.query("DELETE from cart_new where user_id=$1 AND isbn=$2",[userId,itemId]);
            return res.status(200).send("item successfully removed from the cart!!");
        }
    }catch(err){
        console.log("error in removing from the cart:",err.message);
        return res.status(500).send(err.message);
    }

});

app.patch('/cart/update-quantity', async (req, res) => {
    const { userId, itemId, quantity } = req.body;
    if (!userId || !itemId || !quantity) return res.status(400).send("Missing value");

    try {
        const result=await db.query("SELECT price from books_new WHERE isbn=$1",[itemId]);
        if (result.rows.length === 0) {
            return res.status(404).send("Item not found in the database.");
        }
        const actualPrice = result.rows[0].price;
        const newPrice=quantity*actualPrice;
        await db.query(
            "UPDATE cart_new SET quantity=$1,price=$2 WHERE user_id=$3 AND isbn=$4",
            [quantity,newPrice, userId, itemId]
        );
        return res.status(200).json({message:"quantity and price updated successfully!",newPrice});
    } catch (err) {
        console.log("Error updating quantity:", err.message);
        res.status(500).json({ message: "Internal server error" });
    }
});

//end point for accounts
app.get("/account/:userId",async (req,res)=>{
    const userId=req.params.userId;
    if(!req.body) return res.status(400).send("No userId");
    try{
        const result=await db.query("SELECT * FROM accounts WHERE user_id=$1",[userId]);
        if(result.rows.length===0){
            return res.status(404).send("Account details not found");
        }
        return res.status(200).json(result.rows[0]);
    }catch (err) {
        console.error("Error fetching account details:", err.message);
        res.status(500).send("Server error");
    }

});

//endpoint to update the account details
app.put("/account/:userId",async (req,res)=>{
    const userId=req.params.userId;
    const { first_name, last_name, email, street, city, state, zipcode, country, phone, age, gender } = req.body;
    try{
        const result=await db.query("UPDATE accounts SET first_name = $1, last_name = $2, email = $3, street = $4, city = $5, state = $6, zipcode = $7, country = $8, phone = $9, age = $10, gender = $11 WHERE user_id = $12 RETURNING *",[
            first_name, last_name, email, street, city, state, zipcode, country, phone, age, gender, userId
        ]);
        if(await result.rows.length===0){
            return res.status(404).send("Account details not found");
        }
        return res.status(200).json(result.rows[0]);
        }catch(err){
            console.log("Error updating account details:",err.message);
            res.status(500).send("Internal server error");
        }
});

//endpoint to post a new login account information
app.post("/account/:userId",async (req,res)=>{
    const userId=req.params.userId;
    const { first_name, last_name, email, street, city, state, zipcode, country, phone, age, gender } = req.body;
    try{
        const result = await db.query(
            "INSERT INTO accounts (user_id, first_name, last_name, email, street, city, state, zipcode, country, phone, age, gender) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *",
            [userId, first_name, last_name, email, street, city, state, zipcode, country, phone, age, gender]
        );
        return res.status(201).json(result.rows[0]);
        }catch(err){
            console.log("Error updating account details:",err.message);
            res.status(500).send("Internal server error");
        }
});




app.listen(3000,(req,res)=>{
    console.log("running in port 3000");
});
